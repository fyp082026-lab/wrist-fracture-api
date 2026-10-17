/**
 * Read-side data for the clinician's own records. Row Level Security limits
 * every query to the signed-in user; separate queries are merged here so the
 * app does not depend on PostgREST foreign-key embedding.
 */
import { supabase } from '@/services/supabase';
import {
  type AnalysisResultRow,
  type PatientSex,
  type ScanStatus,
  STORAGE_BUCKET,
  parseAnalysisResultRow,
} from '@/services/contract';

const SIGNED_URL_SECONDS = 60 * 30;

export interface PatientSummary {
  id: string;
  patient_code: string | null;
  age_months: number;
  sex: PatientSex;
}

export interface ScanListItem {
  id: string;
  status: ScanStatus;
  created_at: string;
  image_path: string;
  patient: PatientSummary | null;
  result: Pick<AnalysisResultRow, 'fracture_detected' | 'confidence' | 'bone_age_months'> | null;
}

export interface ScanRecord extends Omit<ScanListItem, 'result'> {
  result: AnalysisResultRow | null;
  imageUrl: string | null;
}

export interface ClinicianProfile {
  id: string;
  full_name: string | null;
  hospital: string | null;
}

export class RecordsError extends Error {}

function fail(error: { message?: string } | null, fallback: string): never {
  const offline = /network|fetch|internet|offline/i.test(error?.message ?? '');
  throw new RecordsError(
    offline ? 'No internet connection. Please check your network and try again.' : fallback
  );
}

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

export async function listScans(limit = 100): Promise<ScanListItem[]> {
  const { data: scans, error } = await supabase
    .from('scans')
    .select('id, status, created_at, image_path, patient_id')
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
    status: r.status as ScanStatus,
    created_at: r.created_at,
    image_path: r.image_path,
    patient: r.patient_id ? patients.get(r.patient_id) ?? null : null,
    result: (resultMap.get(r.id) as ScanListItem['result']) ?? null,
  }));
}

export async function getScanRecord(scanId: string): Promise<ScanRecord> {
  const { data: scan, error } = await supabase
    .from('scans')
    .select('id, status, created_at, image_path, patient_id')
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
  const row = resultRes.data?.[0];
  if (row) {
    try {
      result = parseAnalysisResultRow(row);
    } catch {
      result = null; // malformed row: show the scan without a result rather than crash
    }
  }

  return {
    id: scan.id,
    status: scan.status as ScanStatus,
    created_at: scan.created_at,
    image_path: scan.image_path,
    patient: scan.patient_id ? patients.get(scan.patient_id) ?? null : null,
    result,
    imageUrl: signed.data?.signedUrl ?? null,
  };
}

export interface ScanStats {
  total: number;
  completed: number;
  fractures: number;
  pending: number;
  failed: number;
}

export function summarize(items: ScanListItem[]): ScanStats {
  return {
    total: items.length,
    completed: items.filter((s) => s.status === 'completed').length,
    fractures: items.filter((s) => s.result?.fracture_detected).length,
    pending: items.filter((s) => s.status === 'uploaded' || s.status === 'analyzing').length,
    failed: items.filter((s) => s.status === 'failed').length,
  };
}

export async function getProfile(userId: string): Promise<ClinicianProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, hospital')
    .eq('id', userId)
    .maybeSingle();
  if (error) fail(error, 'Could not load your profile.');
  return (data as ClinicianProfile | null) ?? null;
}

/** Creates the row on first use (e.g. no database trigger) and updates it after. */
export async function saveProfile(profile: ClinicianProfile): Promise<ClinicianProfile> {
  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      { id: profile.id, full_name: profile.full_name?.trim() || null, hospital: profile.hospital?.trim() || null },
      { onConflict: 'id' }
    )
    .select('id, full_name, hospital')
    .single();
  if (error) fail(error, 'Could not save your profile.');
  return data as ClinicianProfile;
}
