/**
 * The signed-in account's own row in public.profiles (the single users table).
 * Row Level Security limits these queries to that row; the role is read from
 * the `role` column and decided here, in code.
 */
import { supabase } from '@/services/supabase';

export type Role = 'user' | 'admin';

export interface UserProfile {
  id: string;
  full_name: string | null;
  /** Stored in the `hospital` column; shown as "Organisation". */
  organisation: string | null;
  role: Role;
}

export class AccountError extends Error {}

function fail(error: { message?: string } | null, fallback: string): never {
  const offline = /network|fetch|internet|offline/i.test(error?.message ?? '');
  throw new AccountError(offline ? 'No internet connection. Please check your network and try again.' : fallback);
}

/** Anything other than an explicit 'admin' is treated as a normal user. */
export function roleFrom(value: unknown): Role {
  return value === 'admin' ? 'admin' : 'user';
}

type Row = { id: string; full_name: string | null; hospital: string | null; role?: string | null };
const toProfile = (r: Row): UserProfile => ({
  id: r.id,
  full_name: r.full_name,
  organisation: r.hospital,
  role: roleFrom(r.role),
});

export async function getProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, hospital, role')
    .eq('id', userId)
    .maybeSingle();
  if (error) fail(error, 'Could not load your profile.');
  return data ? toProfile(data as Row) : null;
}

/**
 * Saves name and organisation. The row normally exists (created at sign-up);
 * if not, it is created. The role column can't be written by the app at all.
 */
export async function saveProfile(profile: Pick<UserProfile, 'id' | 'full_name' | 'organisation'>): Promise<UserProfile> {
  const fields = {
    full_name: profile.full_name?.trim() || null,
    hospital: profile.organisation?.trim() || null,
  };
  const updated = await supabase
    .from('profiles')
    .update(fields)
    .eq('id', profile.id)
    .select('id, full_name, hospital, role')
    .maybeSingle();
  if (updated.error) fail(updated.error, 'Could not save your profile.');
  if (updated.data) return toProfile(updated.data as Row);

  const inserted = await supabase
    .from('profiles')
    .insert({ id: profile.id, ...fields })
    .select('id, full_name, hospital, role')
    .single();
  if (inserted.error) fail(inserted.error, 'Could not save your profile.');
  return toProfile(inserted.data as Row);
}

/**
 * The account's role, read from its profile row. If the row can't be read
 * (e.g. offline) the app treats the account as a user, so a bad connection
 * never locks a user out; the server and the database still protect all data.
 */
export async function getRole(userId: string): Promise<Role> {
  const { data, error } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (error || !data) return 'user';
  return roleFrom((data as { role?: string }).role);
}

export const ADMIN_SITE_URL = 'https://wristfracture.duckdns.org/admin/';
export const ADMIN_IN_APP_MESSAGE =
  'This is an administrator account. Administrators sign in on the admin website, not in the app.';
