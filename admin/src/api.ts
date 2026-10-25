import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pediafracture-admin' } }
);

export type Role = 'user' | 'admin';

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

export const MODE_LABEL: Record<AnalysisMode, string> = {
  fracture: 'Fracture detection',
  bone_age: 'Bone age',
  both: 'Fracture + bone age',
};

export const runsFracture = (m: AnalysisMode | null | undefined) => m !== 'bone_age';
export const runsBoneAge = (m: AnalysisMode | null | undefined) => m !== 'fracture';

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

export interface Detection {
  label: string;
  confidence: number;
  box_normalized: [number, number, number, number];
}

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

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

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

export const api = {
  me: () => request<{ email: string; role: Role }>('/admin/api/me'),
  users: () => request<{ users: Account[] }>('/admin/api/users'),
  scans: (params: { status?: string; userId?: string; limit: number; offset: number }) => {
    const q = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
    if (params.status) q.set('status', params.status);
    if (params.userId) q.set('user_id', params.userId);
    return request<{ scans: ScanRow[]; total: number }>(`/admin/api/scans?${q}`);
  },
  scan: (id: string) => request<ScanDetail>(`/admin/api/scans/${encodeURIComponent(id)}`),
};

export function formatMonths(months: number | null | undefined): string {
  if (months == null) return 'Not available';
  const m = Math.round(Number(months));
  return `${Math.floor(m / 12)}y ${m % 12}m`;
}

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

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? 'Unknown'
    : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}
