/**
 * The signed-in user's own account data. Row Level Security limits every
 * query to that user; the role check uses the database's is_admin() function.
 */
import { supabase } from '@/services/supabase';

export type Role = 'user' | 'admin';

export interface UserProfile {
  id: string;
  full_name: string | null;
  /** Stored in the `hospital` column; shown as "Organisation". */
  organisation: string | null;
}

export class AccountError extends Error {}

function fail(error: { message?: string } | null, fallback: string): never {
  const offline = /network|fetch|internet|offline/i.test(error?.message ?? '');
  throw new AccountError(offline ? 'No internet connection. Please check your network and try again.' : fallback);
}

export async function getProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, hospital')
    .eq('id', userId)
    .maybeSingle();
  if (error) fail(error, 'Could not load your profile.');
  return data ? { id: data.id, full_name: data.full_name, organisation: data.hospital } : null;
}

/** Creates the row on first use (e.g. no database trigger) and updates it after. */
export async function saveProfile(profile: UserProfile): Promise<UserProfile> {
  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: profile.id,
        full_name: profile.full_name?.trim() || null,
        hospital: profile.organisation?.trim() || null,
      },
      { onConflict: 'id' }
    )
    .select('id, full_name, hospital')
    .single();
  if (error) fail(error, 'Could not save your profile.');
  return { id: data.id, full_name: data.full_name, organisation: data.hospital };
}

/**
 * The account's role. Admins are managed in Supabase (admin_allowlist) and use
 * the admin website, not this app. Unknown (e.g. offline) is treated as 'user'
 * so a network problem never locks a normal user out; the server and RLS
 * still enforce every permission.
 */
export async function getRole(): Promise<Role> {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) return 'user';
  return data === true ? 'admin' : 'user';
}

export const ADMIN_SITE_URL = 'https://wristfracture.duckdns.org/admin/';
export const ADMIN_IN_APP_MESSAGE =
  'This is an administrator account. Administrators sign in on the admin website, not in the app.';
