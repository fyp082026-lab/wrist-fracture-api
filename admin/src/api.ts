import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pediafracture-admin' } }
);

export type Role = 'user' | 'admin';

export interface Overview {
  users_total: number;
  users_verified: number;
  users_unverified: number;
  users_active_7d: number;
  admins_total: number;
  signups_per_day: { date: string; count: number }[];
}

export interface Account {
  id: string;
  email: string | null;
  full_name: string | null;
  organisation: string | null;
  role: Role;
  created_at: string | null;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
}

export interface Health {
  status: string;
  supabase?: 'ok' | 'error';
  supabase_error?: string | null;
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
  overview: () => request<Overview>('/admin/api/overview'),
  users: () => request<{ users: Account[] }>('/admin/api/users'),
  health: async (): Promise<Health | null> => {
    try {
      const res = await fetch('/health');
      return res.ok ? ((await res.json()) as Health) : null;
    } catch {
      return null;
    }
  },
};

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
