/**
 * Analysis pipeline (see .planning/CONTRACT.md):
 *   1. Reuse the scan row for `scanId`, or create patient + scan (status 'uploaded').
 *   2. Upload the re-encoded JPEG to wrist-xrays/<user_id>/<scan_id>.jpg if absent.
 *   3. POST {base}/analyze with the live session token (90 s timeout).
 *   4. On timeout or network drop, read scans.status and the latest
 *      analysis_results row before deciding anything; retry /analyze only when
 *      the status is still 'uploaded' or 'failed'.
 *
 * The client never writes analysis_results, never sets 'analyzing' or
 * 'completed', and only sets 'failed' for failures before the server is reached.
 *
 * FLOW (who calls what, and where each result goes):
 *   scan form (app/(app)/scan/new.tsx) -> runAnalysisPipeline()
 *     -> ensureScanRecord()     rows in the Supabase tables `patients` and `scans`
 *     -> ensureImageUploaded()  JPEG in the Supabase bucket `wrist-xrays`
 *     -> callAnalyze()          POST /analyze on the analysis server (analysis_server/main.py)
 *     -> AnalyzeResponse        returned to the scan form, which opens the result
 *                               screen (app/(app)/scan/[id].tsx)
 *   Any failure is thrown as AnalysisServiceError; the scan form shows its friendlyMessage.
 */
import * as Crypto from 'expo-crypto';
import { supabase } from '@/app_logic/supabase';
import { devLog, devLogStart } from '@/app_logic/devLogger';
import { config } from '@/app_logic/config';
import {
  type AnalysisMode,
  type AnalyzeRequest,
  type AnalyzeResponse,
  ContractError,
  DEFAULT_CLINICAL_DISCLAIMER,
  type PatientSex,
  STORAGE_BUCKET,
  type ScanStatus,
  DEFAULT_ANALYSIS_MODE,
  buildImagePath,
  formatAgeMonths,
  parseAnalysisResultRow,
  parseAnalyzeResponse,
  toAnalysisMode,
} from '@/app_logic/contract';
import { ImageIntakeError, prepareImageForUpload } from '@/app_logic/imageIntake';

// Timing limits of the pipeline (how long to wait, how often to re-check, how many tries).
export const ANALYZE_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 4_000;
const POLL_WINDOW_MS = 120_000; // slow CPU analysis can outlast the 60 s proxy limit
const MAX_ANALYZE_ATTEMPTS = 2;
const TOKEN_REFRESH_MARGIN_MS = 60_000;
export const MAX_PATIENT_AGE_MONTHS = 240;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every way the pipeline can fail. The scan form reads this to pick the right message / action. */
export type AnalysisErrorType =
  | 'no_internet'
  | 'server_unreachable'
  | 'unauthorized'
  | 'forbidden'
  | 'analysis_failed'
  | 'timeout'
  | 'upload_failed'
  | 'invalid_input'
  | 'invalid_image'
  | 'image_missing'
  | 'not_configured'
  | 'cancelled';

/** The only error the pipeline throws. `friendlyMessage` is shown to the user by the scan form. */
export class AnalysisServiceError extends Error {
  type: AnalysisErrorType;
  friendlyMessage: string;

  constructor(type: AnalysisErrorType, friendlyMessage: string) {
    super(friendlyMessage);
    this.name = 'AnalysisServiceError';
    this.type = type;
    this.friendlyMessage = friendlyMessage;
  }
}

/** Patient details typed on the scan form; saved to the `patients` table by ensureScanRecord(). */
export interface PatientInput {
  ageMonths: number;
  sex: PatientSex;
  /** Optional pseudonymous code; never a name. */
  code?: string;
}

/** Everything runAnalysisPipeline() needs. Built by the scan form (new.tsx). */
export interface AnalysisInput {
  /** Created once per scan attempt by the caller and reused on every retry. */
  scanId: string;
  /** Local image file. Only needed when the image is not in the bucket yet. */
  imageUri?: string | null;
  /** Required for a new scan. For an existing scan the stored values are used. */
  patient?: PatientInput;
  /** Which models to run (new scans only; a retry keeps the scan's stored mode). */
  mode?: AnalysisMode;
  onProgress?: (stage: 'uploading' | 'analyzing') => void;
  signal?: AbortSignal;
}

// User-facing error texts. Each is wrapped in an AnalysisServiceError and shown by the scan form.
const MESSAGES = {
  noInternet: 'No internet connection. Please check your network and try again.',
  serverUnreachable: "Can't reach the analysis server right now. Please try again in a moment.",
  analysisFailed: 'Analysis failed, try again.',
  malformed: 'The analysis service returned an unexpected response. Please try again.',
  forbidden: "This scan doesn't belong to your account.",
  sessionExpired: 'Your session has expired. Please sign in again.',
  serverMisconfigured:
    'The analysis server cannot verify sign-ins right now (server configuration problem). Your scan is saved; please try again later.',
  timeout:
    'The analysis is taking longer than expected. It may still finish; check History in a minute, or try again.',
  recordFailed: 'Could not save the scan record. Please try again.',
  imageMissing: 'The X-ray for this scan was never uploaded. Please select the image again.',
  uploadFailed: 'Could not upload the X-ray. Please check your connection and try again.',
  imageTooSmall:
    'This image is too small for an accurate analysis (at least 512 px on the short side is needed). Use the original X-ray, not a thumbnail or screenshot.',
} as const;

/** A fresh unique scan id. Created by the scan form once per scan and passed to runAnalysisPipeline(). */
export function newScanId(): string {
  return Crypto.randomUUID();
}

/** Returns a user-facing problem, or null when the values may be sent to the model.
 * Used by the scan form (before submitting) and by ensureScanRecord() below. */
export function validatePatient(ageMonths: unknown, sex: unknown): string | null {
  if (
    typeof ageMonths !== 'number' ||
    !Number.isInteger(ageMonths) ||
    ageMonths < 1 ||
    ageMonths > MAX_PATIENT_AGE_MONTHS
  ) {
    return 'Patient age is missing or invalid. Please re-enter the patient details.';
  }
  if (sex !== 'M' && sex !== 'F') {
    return 'Patient biological sex is missing. Please re-enter the patient details.';
  }
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** True when an error looks like "no internet". Result goes to: dbFailure() below. */
export function isNetworkError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? '').toLowerCase();
  return /network request failed|failed to fetch|network ?error|internet|offline|connection/.test(
    msg
  );
}

/** Maps a Supabase (Postgrest / Storage) error to a typed pipeline error with full diagnostic logging.
 * Result goes to: the `throw` of whichever step called it, and from there to the scan form. */
function dbFailure(error: unknown, fallback: string, type: AnalysisErrorType = 'analysis_failed') {
  const postgrestErr = error as { code?: string; message?: string; details?: string; hint?: string } | null;

  console.error(`[Database Error] ${fallback}:`, {
    code: postgrestErr?.code ?? 'UNKNOWN',
    message: postgrestErr?.message ?? String(error),
    details: postgrestErr?.details ?? null,
    hint: postgrestErr?.hint ?? null,
  });

  if (isNetworkError(error)) {
    return new AnalysisServiceError('no_internet', MESSAGES.noInternet);
  }

  // Code 42501: Postgres Row-Level Security violation
  if (postgrestErr?.code === '42501') {
    return new AnalysisServiceError(
      'unauthorized',
      'Database permission denied (Row-Level Security). Please verify your account or database access policies.'
    );
  }

  // Code 42703: Undefined column
  if (postgrestErr?.code === '42703') {
    return new AnalysisServiceError(
      'analysis_failed',
      `Database schema error: ${postgrestErr.message || 'undefined column'}. Please check table migrations.`
    );
  }

  return new AnalysisServiceError(type, fallback);
}

/** Stops the pipeline between steps when the user pressed Cancel on the scan form. */
function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new AnalysisServiceError('cancelled', 'Analysis cancelled.');
}

/** Waits `ms` milliseconds (ends early with 'cancelled' if the user cancels). Used by waitForServer(). */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AnalysisServiceError('cancelled', 'Analysis cancelled.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Builds the API-shaped result from a validated analysis_results row.
 * Input: a database row. Result goes to: loadLatestResult(), so a result read from the
 * database looks exactly like one returned by POST /analyze. */
function resultFromRow(row: unknown, ageMonths: number): AnalyzeResponse {
  let parsed;
  try {
    parsed = parseAnalysisResultRow(row);
  } catch (err) {
    if (err instanceof ContractError) {
      devLog({ stage: 'result-load', status: 'invalid-row', note: err.field });
      throw new AnalysisServiceError('analysis_failed', MESSAGES.malformed);
    }
    throw err;
  }
  return {
    scan_id: parsed.scan_id,
    status: 'completed',
    analysis_mode: parsed.analysis_mode,
    fracture_detected: parsed.fracture_detected,
    fracture_type: parsed.fracture_type,
    confidence: parsed.confidence,
    detections: parsed.detections,
    bone_age_months: parsed.bone_age_months,
    bone_age_formatted:
      parsed.bone_age_months != null ? formatAgeMonths(parsed.bone_age_months) : null,
    chronological_age_formatted: formatAgeMonths(ageMonths),
    grad_cam_path: parsed.grad_cam_path,
    clinical_disclaimer: parsed.clinical_disclaimer || DEFAULT_CLINICAL_DISCLAIMER,
  };
}

/** Reads the newest saved result of a scan from the `analysis_results` table (null if none yet).
 * Result goes to: waitForServer() and runAnalysisPipeline() (recovery after a timeout or retry). */
async function loadLatestResult(scanId: string, ageMonths: number): Promise<AnalyzeResponse | null> {
  const { data, error } = await supabase
    .from('analysis_results')
    .select('*')
    .eq('scan_id', scanId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw dbFailure(error, MESSAGES.analysisFailed);
  return data && data.length > 0 ? resultFromRow(data[0], ageMonths) : null;
}

/** Reads `scans.status` (written by the server). Result goes to: waitForServer() and the
 * recovery step of runAnalysisPipeline(), which decide whether to wait, retry or stop. */
async function readScanStatus(scanId: string): Promise<ScanStatus | null> {
  const { data, error } = await supabase
    .from('scans')
    .select('status')
    .eq('id', scanId)
    .maybeSingle();
  if (error) throw dbFailure(error, MESSAGES.analysisFailed);
  return (data?.status as ScanStatus | undefined) ?? null;
}

/**
 * Waits while the server reports 'analyzing'. Resolves with the result once it
 * completes, with the new status if it drops back to 'uploaded'/'failed', or
 * with null when the polling window closes.
 * Result goes to: runAnalysisPipeline().
 */
async function waitForServer(
  scanId: string,
  ageMonths: number,
  signal?: AbortSignal
): Promise<AnalyzeResponse | 'uploaded' | 'failed' | null> {
  const deadline = Date.now() + POLL_WINDOW_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS, signal);
    const status = await readScanStatus(scanId);
    devLog({ stage: 'poll', status: status ?? 'missing' });
    if (status === 'completed') {
      const result = await loadLatestResult(scanId, ageMonths);
      if (result) return result;
    } else if (status === 'uploaded' || status === 'failed') {
      return status;
    }
  }
  return null;
}

/** Client may only mark 'failed' for its own pre-server failures.
 * Called by ensureImageUploaded() when the image cannot be prepared or uploaded. */
async function markFailedBeforeServer(scanId: string) {
  await supabase.from('scans').update({ status: 'failed' }).eq('id', scanId).eq('status', 'uploaded');
}

/** What ensureScanRecord() hands back to runAnalysisPipeline(): where the scan stands and its stored details. */
interface ScanRecord {
  status: ScanStatus;
  imagePath: string;
  patient: PatientInput;
  mode: AnalysisMode;
}

/** Returns the existing scan (with its stored patient values) or creates it.
 * Writes: one row in `patients` and one in `scans` (status 'uploaded') for a new scan.
 * Result goes to: runAnalysisPipeline(), which uses the image path, patient values and mode. */
async function ensureScanRecord(
  userId: string,
  scanId: string,
  patient: PatientInput | undefined,
  mode: AnalysisMode
): Promise<ScanRecord> {
  const { data: existing, error: readError } = await supabase
    .from('scans')
    .select('status, image_path, analysis_mode, patients(age_months, sex, patient_code)')
    .eq('id', scanId)
    .maybeSingle();
  if (readError) throw dbFailure(readError, MESSAGES.recordFailed);

  // Case 1 - the scan already exists (a retry): reuse its stored patient values and mode.
  if (existing) {
    const p: any = Array.isArray(existing.patients) ? existing.patients[0] : existing.patients;
    const stored = { ageMonths: p?.age_months, sex: p?.sex };
    const problem = validatePatient(stored.ageMonths, stored.sex);
    if (problem) throw new AnalysisServiceError('invalid_input', problem);
    return {
      status: existing.status as ScanStatus,
      imagePath: existing.image_path,
      patient: { ageMonths: stored.ageMonths, sex: stored.sex, code: p?.patient_code },
      mode: toAnalysisMode(existing.analysis_mode),
    };
  }

  // Case 2 - a new scan: validate the patient details, then create the patient and scan rows.
  if (!patient) {
    throw new AnalysisServiceError(
      'invalid_input',
      'Patient details are missing. Please start the scan again.'
    );
  }
  const problem = validatePatient(patient.ageMonths, patient.sex);
  if (problem) throw new AnalysisServiceError('invalid_input', problem);

  const patientCode = patient.code?.trim() || `P-${Math.floor(1000 + Math.random() * 9000)}`;
  const { data: patientRow, error: patientError } = await supabase
    .from('patients')
    .insert({
      user_id: userId,
      patient_code: patientCode,
      age_months: patient.ageMonths,
      sex: patient.sex,
    })
    .select('id')
    .single();
  if (patientError || !patientRow) throw dbFailure(patientError, MESSAGES.recordFailed);

  const imagePath = buildImagePath(userId, scanId);
  const { error: scanError } = await supabase.from('scans').insert({
    id: scanId,
    user_id: userId,
    patient_id: patientRow.id,
    image_path: imagePath,
    status: 'uploaded',
    analysis_mode: mode,
  });
  if (scanError) {
    // Best effort: do not leave an orphaned patient row behind.
    await supabase.from('patients').delete().eq('id', patientRow.id);
    // 23505 = unique violation: a concurrent run already created this scan; reuse it.
    if ((scanError as { code?: string }).code === '23505') {
      return ensureScanRecord(userId, scanId, patient, mode);
    }
    throw dbFailure(scanError, MESSAGES.recordFailed);
  }

  return { status: 'uploaded', imagePath, patient: { ...patient, code: patientCode }, mode };
}

/** Is the X-ray already in the storage bucket? Result goes to: ensureImageUploaded() (skip a second upload). */
async function imageExistsInBucket(imagePath: string): Promise<boolean> {
  const slash = imagePath.lastIndexOf('/');
  const folder = imagePath.slice(0, slash);
  const name = imagePath.slice(slash + 1);
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list(folder, { search: name });
  if (error) throw dbFailure(error, MESSAGES.uploadFailed, 'upload_failed');
  return (data ?? []).some((f) => f.name === name && (f.metadata?.size ?? 1) > 0);
}

/** Makes sure the X-ray is in Supabase Storage: prepares the local file with
 * imageIntake.prepareImageForUpload() and uploads it. The server later downloads it from
 * the same path during POST /analyze. Returns nothing; throws on failure. */
async function ensureImageUploaded(
  scanId: string,
  imagePath: string,
  imageUri: string | null | undefined,
  signal?: AbortSignal
) {
  if (await imageExistsInBucket(imagePath)) {
    devLog({ stage: 'skip-upload', status: 'ok', note: 'file already in bucket' });
    return;
  }
  // Remote (signed) URLs are display-only; only a local file can be uploaded.
  if (!imageUri || /^https?:/i.test(imageUri)) {
    throw new AnalysisServiceError('image_missing', MESSAGES.imageMissing);
  }
  throwIfCancelled(signal);

  const resizeStart = devLogStart();
  let prepared;
  try {
    prepared = await prepareImageForUpload(imageUri);
    devLog({ stage: 'resize', status: 'ok', elapsedMs: Date.now() - resizeStart });
  } catch (err) {
    devLog({ stage: 'resize', status: 'error', elapsedMs: Date.now() - resizeStart });
    await markFailedBeforeServer(scanId);
    if (err instanceof ImageIntakeError) {
      throw new AnalysisServiceError('invalid_image', err.message);
    }
    throw new AnalysisServiceError('invalid_image', 'The X-ray image could not be processed.');
  }
  throwIfCancelled(signal);

  const uploadStart = devLogStart();
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(imagePath, prepared.data, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) {
    devLog({ stage: 'upload', status: 'error', elapsedMs: Date.now() - uploadStart });
    await markFailedBeforeServer(scanId);
    throw dbFailure(error, MESSAGES.uploadFailed, 'upload_failed');
  }
  devLog({ stage: 'upload', status: 'ok', elapsedMs: Date.now() - uploadStart });
}

// ─── /analyze call ───────────────────────────────────────────────────────────

/** What one network attempt produced: a real HTTP answer, a timeout, or no connection. */
type TransportOutcome = { kind: 'response'; response: Response } | { kind: 'timeout' } | { kind: 'network' };

/** Proxy answers that mean "no reply in time", not "the analysis failed". */
export const GATEWAY_TIMEOUT_STATUSES = new Set([502, 504]);

/** Sends one POST /analyze request with a 90 s timeout.
 * Result goes to: callAnalyze(), as a TransportOutcome. */
async function postAnalyze(
  body: AnalyzeRequest,
  token: string,
  signal?: AbortSignal
): Promise<TransportOutcome> {
  throwIfCancelled(signal);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ANALYZE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(config.analyzeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // 502/504 come from nginx in front of the API, usually because the analysis
    // took longer than the proxy waits. The server keeps working and saves the
    // result, so treat it like our own timeout: read the database, don't fail.
    if (GATEWAY_TIMEOUT_STATUSES.has(response.status)) {
      return { kind: 'timeout' };
    }
    return { kind: 'response', response };
  } catch {
    if (signal?.aborted) throw new AnalysisServiceError('cancelled', 'Analysis cancelled.');
    return timedOut ? { kind: 'timeout' } : { kind: 'network' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Turns the server's HTTP answer into a checked result or a typed error.
 * Uses contract.parseAnalyzeResponse() to validate the JSON.
 * Result goes to: callAnalyze() -> runAnalysisPipeline() -> the scan form. */
async function interpretResponse(response: Response, scanId: string): Promise<AnalyzeResponse> {
  if (response.status === 401) {
    throw new AnalysisServiceError('unauthorized', MESSAGES.sessionExpired);
  }
  if (response.status === 403) {
    throw new AnalysisServiceError('forbidden', MESSAGES.forbidden);
  }
  if (response.status === 503) {
    throw new AnalysisServiceError('server_unreachable', MESSAGES.serverMisconfigured);
  }
  if (response.status === 422) {
    // The only 422 the server sends for a valid request: the image is too small.
    throw new AnalysisServiceError('invalid_image', MESSAGES.imageTooSmall);
  }
  if (!response.ok) {
    // 500 and anything unexpected. Server error text is never shown to the user.
    throw new AnalysisServiceError('analysis_failed', MESSAGES.analysisFailed);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    devLog({ stage: 'result-load', status: 'parse-error' });
    throw new AnalysisServiceError('analysis_failed', MESSAGES.malformed);
  }
  try {
    const result = parseAnalyzeResponse(json, scanId);
    devLog({ stage: 'result-load', status: 'ok' });
    return result;
  } catch (err) {
    if (err instanceof ContractError) {
      devLog({ stage: 'result-load', status: 'invalid-response', note: err.field });
      throw new AnalysisServiceError('analysis_failed', MESSAGES.malformed);
    }
    throw err;
  }
}

/**
 * One logical /analyze call with the live session token. A 401 refreshes the
 * session once and retries once; a second 401 (or failed refresh) is fatal.
 * Result goes to: runAnalysisPipeline(): the result, or 'timeout' / 'network'
 * so the pipeline can check the database before retrying.
 */
async function callAnalyze(
  body: AnalyzeRequest,
  signal?: AbortSignal
): Promise<AnalyzeResponse | 'timeout' | 'network'> {
  let {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new AnalysisServiceError('unauthorized', MESSAGES.sessionExpired);
  }

  // Never send a token that is about to expire: refresh first, so the request
  // does not depend on the server's 401 handling for the common expiry case.
  if (session.expires_at && session.expires_at * 1000 - Date.now() < TOKEN_REFRESH_MARGIN_MS) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    if (refreshed.session?.access_token) session = refreshed.session;
    devLog({ stage: 'api-call', status: 'pre-refreshed expiring token' });
  }

  const start = devLogStart();
  devLog({ stage: 'api-call', status: 'sending' });
  let outcome = await postAnalyze(body, session.access_token, signal);
  devLog({
    stage: 'api-call',
    status: outcome.kind === 'response' ? outcome.response.status : outcome.kind,
    elapsedMs: Date.now() - start,
  });

  if (outcome.kind === 'response' && outcome.response.status === 401) {
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    if (error || !refreshed.session?.access_token) {
      throw new AnalysisServiceError('unauthorized', MESSAGES.sessionExpired);
    }
    devLog({ stage: 'api-call', status: 'retrying after 401 refresh' });
    outcome = await postAnalyze(body, refreshed.session.access_token, signal);
    devLog({
      stage: 'api-call',
      status: outcome.kind === 'response' ? outcome.response.status : outcome.kind,
      note: 'after refresh',
    });
  }

  if (outcome.kind !== 'response') return outcome.kind;
  return interpretResponse(outcome.response, body.scan_id);
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

/**
 * The whole scan, start to finish. Called by the scan form (app/(app)/scan/new.tsx),
 * for a new scan and for a retry of the same scan.
 * Result goes to: the caller, which shows the AnalyzeResponse on the result screen.
 */
export async function runAnalysisPipeline(input: AnalysisInput): Promise<AnalyzeResponse> {
  const { scanId, signal } = input;

  // STEP 0 - basic checks: server address configured, valid scan id, signed-in user.
  if (!config.analyzeUrl) {
    throw new AnalysisServiceError(
      'not_configured',
      'The analysis server is not configured in this build.'
    );
  }
  if (!UUID_PATTERN.test(scanId)) {
    throw new AnalysisServiceError('invalid_input', 'This scan reference is invalid. Please start again.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id ?? null;
  if (!userId) {
    throw new AnalysisServiceError('unauthorized', MESSAGES.sessionExpired);
  }

  // STEP 1 - create (or reuse) the patient and scan rows. onProgress updates the scan form's status text.
  input.onProgress?.('uploading');
  const scan = await ensureScanRecord(userId, scanId, input.patient, input.mode ?? DEFAULT_ANALYSIS_MODE);
  const ageMonths = scan.patient.ageMonths;
  throwIfCancelled(signal);

  // A retry may find the work already done or in progress on the server.
  if (scan.status === 'completed') {
    const existing = await loadLatestResult(scanId, ageMonths);
    if (existing) return existing;
  } else if (scan.status === 'analyzing') {
    input.onProgress?.('analyzing');
    const waited = await waitForServer(scanId, ageMonths, signal);
    if (waited === null) throw new AnalysisServiceError('timeout', MESSAGES.timeout);
    if (typeof waited === 'object') return waited;
    // Dropped back to 'uploaded' / 'failed': the server will accept a new call.
  }

  // STEP 2 - upload the X-ray if it is not in the bucket yet.
  await ensureImageUploaded(scanId, scan.imagePath, input.imageUri, signal);
  input.onProgress?.('analyzing');

  // STEP 3 - ask the server to analyse it. This is the JSON that analysis_server/main.py receives.
  const body: AnalyzeRequest = {
    scan_id: scanId,
    image_path: scan.imagePath,
    patient_age_months: ageMonths,
    patient_sex: scan.patient.sex,
    analysis_mode: scan.mode,
  };

  // STEP 4 - call the server; on a timeout or dropped connection, look in the database
  // for a result the server may already have saved before trying once more.
  for (let attempt = 1; attempt <= MAX_ANALYZE_ATTEMPTS; attempt++) {
    const outcome = await callAnalyze(body, signal);
    if (typeof outcome === 'object') return outcome;

    // Timeout or network drop: never blindly retry. Ask the database first.
    devLog({ stage: 'recover', status: outcome, note: `attempt ${attempt}` });
    const status = await readScanStatus(scanId); // throws no_internet if we are offline

    if (status === 'completed') {
      const recovered = await loadLatestResult(scanId, ageMonths);
      if (recovered) return recovered;
    } else if (status === 'analyzing') {
      const waited = await waitForServer(scanId, ageMonths, signal);
      if (waited === null) throw new AnalysisServiceError('timeout', MESSAGES.timeout);
      if (typeof waited === 'object') return waited;
    }

    // Status is 'uploaded' or 'failed': a retry is allowed, once.
    if (attempt === MAX_ANALYZE_ATTEMPTS) {
      throw outcome === 'timeout'
        ? new AnalysisServiceError('timeout', MESSAGES.timeout)
        : new AnalysisServiceError('server_unreachable', MESSAGES.serverUnreachable);
    }
  }

  // Unreachable: the loop always returns or throws.
  throw new AnalysisServiceError('analysis_failed', MESSAGES.analysisFailed);
}
