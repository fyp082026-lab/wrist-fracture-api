/**
 * Read-side data for the user's own records. Row Level Security limits
 * every query to the signed-in user; separate queries are merged here so the
 * app does not depend on PostgREST foreign-key embedding.
 *
 * FLOW: Supabase tables `scans`, `patients`, `analysis_results` ->
 *   listScans()     -> scan_data_hooks/useScans.ts -> Home and History screens
 *   getScanRecord() -> result screen (app/(app)/scan/[id].tsx)
 *   summarize()     -> the counters on the Home screen
 * Nothing here writes to the database.
 */
import { supabase } from '@/app_logic/supabase';
import {
  type AnalysisMode,
  type AnalysisResultRow,
  type PatientSex,
  type ScanStatus,
  STORAGE_BUCKET,
  parseAnalysisResultRow,
  toAnalysisMode,
} from '@/app_logic/contract';

const SIGNED_URL_SECONDS = 60 * 30;

/** The patient details shown next to a scan. */
export interface PatientSummary {
  id: string;
  patient_code: string | null;
  age_months: number;
  sex: PatientSex;
}

/** One scan as shown in a list (Home, History). Returned by listScans(). */
export interface ScanListItem {
  id: string;
  status: ScanStatus;
  /** Which models the scan ran: fracture detection, bone age, or both. */
  mode: AnalysisMode;
  created_at: string;
  image_path: string;
  patient: PatientSummary | null;
  result: Pick<AnalysisResultRow, 'fracture_detected' | 'confidence' | 'bone_age_months'> | null;
}

/** One scan with its full result and a temporary link to the X-ray. Returned by getScanRecord(). */
export interface ScanRecord extends Omit<ScanListItem, 'result'> {
  result: AnalysisResultRow | null;
  /** A result row exists but could not be read (shown as an error, not "still working"). */
  resultUnreadable: boolean;
  imageUrl: string | null;
}

/** Error with a message that is safe to show. Thrown by fail(); shown by the screens. */
export class RecordsError extends Error {}

/** Turns a Supabase error into a RecordsError (a clear "no internet" text when offline). */
function fail(error: { message?: string } | null, fallback: string): never {
  const offline = /network|fetch|internet|offline/i.test(error?.message ?? '');
  throw new RecordsError(
    offline ? 'No internet connection. Please check your network and try again.' : fallback
  );
}

/** Loads the patients for a set of ids. Result goes to: listScans() and getScanRecord(). */
async function patientsById(ids: (string | null)[]): Promise<Map<string, PatientSummary>> {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase
    .from('patients')
    .select('id, patient_code, age_months, sex')
    .in('id', unique);
  if (error) fail(error, 'Could not load patient details.');
  return new Map((data ?? []).map((p) => [p.id as string, p as PatientSummary]));
}

// A saved result means the analysis finished, whatever the status column says
// (a failed status update must never hide a result that is already stored).
// Result goes to: listScans() and getScanRecord(), as the status the screens display.
export function effectiveStatus(status: string, hasResult: boolean): ScanStatus {
  return hasResult ? 'completed' : (status as ScanStatus);
}

/** The user's scans, newest first, each joined with its patient and short result.
 * Result goes to: useScans() -> Home and History screens. */
export async function listScans(limit = 100): Promise<ScanListItem[]> {
  const { data: scans, error } = await supabase
    .from('scans')
    .select('id, status, analysis_mode, created_at, image_path, patient_id')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) fail(error, 'Could not load your scans.');
  const rows = scans ?? [];
  if (rows.length === 0) return [];

  const [patients, results] = await Promise.all([
    patientsById(rows.map((r) => r.patient_id)),
    supabase
      .from('analysis_results')
      .select('scan_id, fracture_detected, confidence, bone_age_months')
      .in('scan_id', rows.map((r) => r.id)),
  ]);
  if (results.error) fail(results.error, 'Could not load analysis results.');
  const resultMap = new Map((results.data ?? []).map((r) => [r.scan_id as string, r]));

  return rows.map((r) => ({
    id: r.id,
    status: effectiveStatus(r.status, resultMap.has(r.id)),
    mode: toAnalysisMode(r.analysis_mode),
    created_at: r.created_at,
    image_path: r.image_path,
    patient: r.patient_id ? patients.get(r.patient_id) ?? null : null,
    result: (resultMap.get(r.id) as ScanListItem['result']) ?? null,
  }));
}

/** Everything about one scan: scan row, patient, full checked result and a 30-minute
 * link to the X-ray image. Result goes to: the result screen (app/(app)/scan/[id].tsx). */
export async function getScanRecord(scanId: string): Promise<ScanRecord> {
  const { data: scan, error } = await supabase
    .from('scans')
    .select('id, status, analysis_mode, created_at, image_path, patient_id')
    .eq('id', scanId)
    .maybeSingle();
  if (error) fail(error, 'Could not load this scan.');
  if (!scan) throw new RecordsError('This scan was not found in your account.');

  const [patients, resultRes, signed] = await Promise.all([
    patientsById([scan.patient_id]),
    supabase
      .from('analysis_results')
      .select('*')
      .eq('scan_id', scanId)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase.storage.from(STORAGE_BUCKET).createSignedUrl(scan.image_path, SIGNED_URL_SECONDS),
  ]);
  if (resultRes.error) fail(resultRes.error, 'Could not load the analysis result.');

  let result: AnalysisResultRow | null = null;
  let resultUnreadable = false;
  const row = resultRes.data?.[0];
  if (row) {
    try {
      result = parseAnalysisResultRow(row);
    } catch {
      result = null;
      resultUnreadable = true; // saved but unreadable: say so instead of "still working"
    }
  }

  return {
    id: scan.id,
    status: effectiveStatus(scan.status, Boolean(row)),
    mode: toAnalysisMode(scan.analysis_mode),
    created_at: scan.created_at,
    image_path: scan.image_path,
    patient: scan.patient_id ? patients.get(scan.patient_id) ?? null : null,
    result,
    resultUnreadable,
    imageUrl: signed.data?.signedUrl ?? null,
  };
}

/** The counters shown on the Home screen. Returned by summarize(). */
export interface ScanStats {
  total: number;
  completed: number;
  fractures: number;
  pending: number;
  failed: number;
}

/** Counts scans by outcome. Input: the list from listScans(). Result goes to: the Home screen tiles. */
export function summarize(items: ScanListItem[]): ScanStats {
  return {
    total: items.length,
    completed: items.filter((s) => s.status === 'completed').length,
    fractures: items.filter((s) => s.result?.fracture_detected).length,
    pending: items.filter((s) => s.status === 'uploaded' || s.status === 'analyzing').length,
    failed: items.filter((s) => s.status === 'failed').length,
  };
}
