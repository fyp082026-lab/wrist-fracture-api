/**
 * api.ts — the admin website's only link to the outside world.
 *
 * FLOW: a dashboard page calls api.users() / api.scans() / ... -> request()
 * adds the admin's sign-in token -> analysis server (/admin/api, see
 * analysis_server/admin.py) -> typed JSON goes back to the page that asked.
 * Also holds the Supabase client (sign-in) and small text formatters.
 */
import { createClient } from '@supabase/supabase-js';

// Supabase client, used for sign-in only (App.tsx). Data never comes from here;
// it comes from the analysis server through request() below.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pediafracture-admin' } }
);

export type Role = 'user' | 'admin';

/** One row of the Users page, as sent by GET /admin/api/users. */
export interface Account {
  id: string;
  email: string | null;
  full_name: string | null;
  organisation: string | null;
  role: Role;
  created_at: string | null;
}

export type ScanStatus = 'uploaded' | 'analyzing' | 'completed' | 'failed';

/** Which AI models a scan ran (fusion is not trained yet). */
export type AnalysisMode = 'fracture' | 'bone_age' | 'both';

/** Readable name of each analysis mode. Shown by the Scans page and the scan drawer. */
export const MODE_LABEL: Record<AnalysisMode, string> = {
  fracture: 'Fracture detection',
  bone_age: 'Bone age',
  both: 'Fracture + bone age',
};

// Did a scan run this model? Used by Scans.tsx and ScanDrawer.tsx to show
// "Not run" instead of an empty result.
export const runsFracture = (m: AnalysisMode | null | undefined) => m !== 'bone_age';
export const runsBoneAge = (m: AnalysisMode | null | undefined) => m !== 'fracture';

/** One row of the Scans table, as sent by GET /admin/api/scans. */
export interface ScanRow {
  id: string;
  user_id: string;
  patient_id: string | null;
  status: ScanStatus;
  analysis_mode: AnalysisMode | null;
  created_at: string;
  user_email: string | null;
  patient_code: string | null;
  patient_age_months: number | null;
  patient_sex: 'M' | 'F' | null;
  fracture_detected: boolean | null;
  confidence: number | null;
  bone_age_months: number | null;
}

/** One fracture box (corners as fractions of the image). Drawn by ScanDrawer.tsx. */
export interface Detection {
  label: string;
  confidence: number;
  box_normalized: [number, number, number, number];
}

/** Everything about one scan, as sent by GET /admin/api/scans/{id}. Shown by ScanDrawer.tsx. */
export interface ScanDetail {
  scan: { id: string; user_id: string; status: ScanStatus; analysis_mode: AnalysisMode | null; created_at: string; image_path: string };
  patient: { patient_code: string | null; age_months: number | null; sex: 'M' | 'F' | null } | null;
  result: {
    analysis_mode?: AnalysisMode | null;
    /** null when fracture detection was not run. */
    fracture_detected: boolean | null;
    confidence: number | null;
    fracture_confidence?: number | null;
    detections: Detection[] | null;
    bone_age_months: number | null;
    clinical_disclaimer: string | null;
    created_at: string;
  } | null;
  user_email: string | null;
  image_url: string | null;
}

/** Live numbers for one model, from every scan that ran it. */
export interface ModelStatsBase {
  scans: number;
  completed: number;
  failed: number;
  in_progress: number;
}

export interface FractureStats extends ModelStatsBase {
  model: 'fracture';
  fracture_suggested: number;
  no_fracture: number;
  lower_confidence: number;
  low_confidence_threshold: number;
  mean_confidence: number | null;
  confidence_bins: number[];
}

export interface BoneAgeStats extends ModelStatsBase {
  model: 'bone_age';
  with_estimate: number;
  mean_abs_gap_months: number | null;
  mean_gap_months: number | null;
  within_12_months: number;
  points: { actual_months: number; bone_age_months: number }[];
}

export type ModelStats = FractureStats | BoneAgeStats;

/** A failed server call with its HTTP status. App.tsx reads the status (401/403/503)
 * to decide what to show; pages show the message. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Sends one GET request to the analysis server with the admin's token.
 * Result goes to: the `api` functions below, and from them to the calling page.
 * A non-200 answer is thrown as ApiError.
 */
async function request<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, 'Not signed in');
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.detail ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/**
 * One function per server route. Each returns its JSON to the page that called it:
 *   me -> App.tsx (admin check)      users -> Users.tsx      scans -> Scans.tsx
 *   modelStats -> AiModel.tsx        scan -> ScanDrawer.tsx
 */
export const api = {
  me: () => request<{ email: string; role: Role }>('/admin/api/me'),
  users: () => request<{ users: Account[] }>('/admin/api/users'),
  scans: (params: { status?: string; userId?: string; model?: 'fracture' | 'bone_age'; limit: number; offset: number }) => {
    const q = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
    if (params.status) q.set('status', params.status);
    if (params.userId) q.set('user_id', params.userId);
    if (params.model) q.set('model', params.model);
    return request<{ scans: ScanRow[]; total: number }>(`/admin/api/scans?${q}`);
  },
  modelStats: (model: 'fracture' | 'bone_age') => request<ModelStats>(`/admin/api/models/${model}/stats`),
  scan: (id: string) => request<ScanDetail>(`/admin/api/scans/${encodeURIComponent(id)}`),
};

/** Months -> "7y 3m". Used wherever an age is shown (Scans, ScanDrawer, AiModel). */
export function formatMonths(months: number | null | undefined): string {
  if (months == null) return 'Not available';
  const m = Math.round(Number(months));
  return `${Math.floor(m / 12)}y ${m % 12}m`;
}

/** A date -> "5 min ago" / "3 d ago". Used by the "When" column of the Scans table. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} d ago` : formatDate(iso);
}

/** A date -> a short readable date. Used by the Users page, the scan drawer and relativeTime(). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? 'Unknown'
    : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}
