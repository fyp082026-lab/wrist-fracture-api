import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pediafracture-admin' } }
);

export type ScanStatus = 'uploaded' | 'analyzing' | 'completed' | 'failed';

export interface Overview {
  users_total: number;
  users_active_7d: number;
  patients_total: number;
  scans_total: number;
  scans_by_status: Record<ScanStatus, number>;
  fractures_detected: number;
  results_total: number;
  scans_per_day: { date: string; count: number }[];
}

export interface AdminUser {
  id: string;
  email: string | null;
  full_name: string | null;
  hospital: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  is_admin: boolean;
  scan_count: number;
  last_scan_at: string | null;
}

export interface ScanRow {
  id: string;
  user_id: string;
  patient_id: string | null;
  status: ScanStatus;
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
  scan: { id: string; user_id: string; status: ScanStatus; created_at: string; image_path: string };
  patient: { patient_code: string | null; age_months: number | null; sex: 'M' | 'F' | null } | null;
  result: {
    fracture_detected: boolean;
    confidence: number | null;
    detections: Detection[] | null;
    bone_age_months: number | null;
    clinical_disclaimer: string | null;
    created_at: string;
  } | null;
  user_email: string | null;
  image_url: string | null;
}

export interface Health {
  status: string;
  device: string;
  bone_age_model: boolean;
  bone_age_error: string | null;
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
  me: () => request<{ email: string; is_admin: boolean }>('/admin/api/me'),
  overview: () => request<Overview>('/admin/api/overview'),
  users: () => request<{ users: AdminUser[] }>('/admin/api/users'),
  scans: (params: { status?: string; userId?: string; limit: number; offset: number }) => {
    const q = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
    if (params.status) q.set('status', params.status);
    if (params.userId) q.set('user_id', params.userId);
    return request<{ scans: ScanRow[]; total: number }>(`/admin/api/scans?${q}`);
  },
  scan: (id: string) => request<ScanDetail>(`/admin/api/scans/${encodeURIComponent(id)}`),
  health: async (): Promise<Health | null> => {
    try {
      const res = await fetch('/health');
      return res.ok ? ((await res.json()) as Health) : null;
    } catch {
      return null;
    }
  },
};

export function formatMonths(months: number | null | undefined): string {
  if (months == null) return 'Not available';
  const m = Math.round(months);
  return `${Math.floor(m / 12)}y ${m % 12}m`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? 'Unknown'
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} d ago` : formatDate(iso);
}
