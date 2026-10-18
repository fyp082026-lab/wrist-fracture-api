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
 */
import * as Crypto from 'expo-crypto';
import { supabase } from '@/services/supabase';
import { devLog, devLogStart } from '@/services/devLogger';
import { config } from '@/services/config';
import {
  type AnalyzeRequest,
  type AnalyzeResponse,
  ContractError,
  DEFAULT_CLINICAL_DISCLAIMER,
  type PatientSex,
  STORAGE_BUCKET,
  type ScanStatus,
  buildImagePath,
  formatAgeMonths,
  parseAnalysisResultRow,
  parseAnalyzeResponse,
} from '@/services/contract';
import { ImageIntakeError, prepareImageForUpload } from '@/services/imageIntake';

export const ANALYZE_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 4_000;
const POLL_WINDOW_MS = 60_000;
const MAX_ANALYZE_ATTEMPTS = 2;
const TOKEN_REFRESH_MARGIN_MS = 60_000;
export const MAX_PATIENT_AGE_MONTHS = 240;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export interface PatientInput {
  ageMonths: number;
  sex: PatientSex;
  /** Optional pseudonymous code; never a name. */
  code?: string;
}

export interface AnalysisInput {
  /** Created once per scan attempt by the caller and reused on every retry. */
  scanId: string;
  /** Local image file. Only needed when the image is not in the bucket yet. */
  imageUri?: string | null;
  /** Required for a new scan. For an existing scan the stored values are used. */
  patient?: PatientInput;
  onProgress?: (stage: 'uploading' | 'analyzing') => void;
  signal?: AbortSignal;
}

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
} as const;

export function newScanId(): string {
  return Crypto.randomUUID();
}

/** Returns a user-facing problem, or null when the values may be sent to the model. */
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

export function isNetworkError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? '').toLowerCase();
  return /network request failed|failed to fetch|network ?error|internet|offline|connection/.test(
    msg
  );
}

/** Maps a Supabase (Postgrest / Storage) error to a typed pipeline error with full diagnostic logging. */
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

function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new AnalysisServiceError('cancelled', 'Analysis cancelled.');
}

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

/** Builds the API-shaped result from a validated analysis_results row. */
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

/** Client may only mark 'failed' for its own pre-server failures. */
async function markFailedBeforeServer(scanId: string) {
  await supabase.from('scans').update({ status: 'failed' }).eq('id', scanId).eq('status', 'uploaded');
}

interface ScanRecord {
  status: ScanStatus;
  imagePath: string;
  patient: PatientInput;
}

/** Returns the existing scan (with its stored patient values) or creates it. */
async function ensureScanRecord(
  userId: string,
  scanId: string,
  patient: PatientInput | undefined
): Promise<ScanRecord> {
  const { data: existing, error: readError } = await supabase
    .from('scans')
    .select('status, image_path, patients(age_months, sex, patient_code)')
    .eq('id', scanId)
    .maybeSingle();
  if (readError) throw dbFailure(readError, MESSAGES.recordFailed);

  if (existing) {
    const p: any = Array.isArray(existing.patients) ? existing.patients[0] : existing.patients;
    const stored = { ageMonths: p?.age_months, sex: p?.sex };
    const problem = validatePatient(stored.ageMonths, stored.sex);
    if (problem) throw new AnalysisServiceError('invalid_input', problem);
    return {
      status: existing.status as ScanStatus,
      imagePath: existing.image_path,
      patient: { ageMonths: stored.ageMonths, sex: stored.sex, code: p?.patient_code },
    };
  }

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
  });
  if (scanError) {
    // Best effort: do not leave an orphaned patient row behind.
    await supabase.from('patients').delete().eq('id', patientRow.id);
    // 23505 = unique violation: a concurrent run already created this scan; reuse it.
    if ((scanError as { code?: string }).code === '23505') {
      return ensureScanRecord(userId, scanId, patient);
    }
    throw dbFailure(scanError, MESSAGES.recordFailed);
  }

  return { status: 'uploaded', imagePath, patient: { ...patient, code: patientCode } };
}

async function imageExistsInBucket(imagePath: string): Promise<boolean> {
  const slash = imagePath.lastIndexOf('/');
  const folder = imagePath.slice(0, slash);
  const name = imagePath.slice(slash + 1);
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list(folder, { search: name });
  if (error) throw dbFailure(error, MESSAGES.uploadFailed, 'upload_failed');
  return (data ?? []).some((f) => f.name === name && (f.metadata?.size ?? 1) > 0);
}

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

type TransportOutcome = { kind: 'response'; response: Response } | { kind: 'timeout' } | { kind: 'network' };

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
    return { kind: 'response', response };
  } catch {
    if (signal?.aborted) throw new AnalysisServiceError('cancelled', 'Analysis cancelled.');
    return timedOut ? { kind: 'timeout' } : { kind: 'network' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

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

export async function runAnalysisPipeline(input: AnalysisInput): Promise<AnalyzeResponse> {
  const { scanId, signal } = input;

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

  input.onProgress?.('uploading');
  const scan = await ensureScanRecord(userId, scanId, input.patient);
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

  await ensureImageUploaded(scanId, scan.imagePath, input.imageUri, signal);
  input.onProgress?.('analyzing');

  const body: AnalyzeRequest = {
    scan_id: scanId,
    image_path: scan.imagePath,
    patient_age_months: ageMonths,
    patient_sex: scan.patient.sex,
  };

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
