/**
 * The signed-in account's own row in public.profiles (the single users table).
 * Row Level Security limits these queries to that row; the role is read from
 * the `role` column and decided here, in code.
 *
 * FLOW: auth_session/AuthContext.tsx calls getProfile() / saveProfile() / getRole()
 * -> Supabase table `profiles` -> the profile and role go back to AuthContext,
 * which shares them with every screen (and refuses admin accounts).
 */
import { supabase } from '@/app_logic/supabase';

export type Role = 'user' | 'admin';

export interface UserProfile {
  id: string;
  full_name: string | null;
  /** Stored in the `hospital` column; shown as "Organisation". */
  organisation: string | null;
  role: Role;
}

/** Error with a message that is safe to show. Thrown by fail(); shown by the profile screen. */
export class AccountError extends Error {}

/** Turns a Supabase error into an AccountError (a clear "no internet" text when offline). */
function fail(error: { message?: string } | null, fallback: string): never {
  const offline = /network|fetch|internet|offline/i.test(error?.message ?? '');
  throw new AccountError(offline ? 'No internet connection. Please check your network and try again.' : fallback);
}

/** Anything other than an explicit 'admin' is treated as a normal user.
 * Result goes to: toProfile() and getRole(). */
export function roleFrom(value: unknown): Role {
  return value === 'admin' ? 'admin' : 'user';
}

// Database row -> the UserProfile shape the app uses (the `hospital` column is shown as "organisation").
type Row = { id: string; full_name: string | null; hospital: string | null; role?: string | null };
const toProfile = (r: Row): UserProfile => ({
  id: r.id,
  full_name: r.full_name,
  organisation: r.hospital,
  role: roleFrom(r.role),
});

/** Loads the signed-in user's profile row (null if it does not exist yet).
 * Result goes to: AuthContext, then the Home and Profile screens. */
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
 * Result goes to: AuthContext (which updates the profile shown on every screen).
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
 * Result goes to: AuthContext, which signs an 'admin' out with ADMIN_IN_APP_MESSAGE.
 */
export async function getRole(userId: string): Promise<Role> {
  const { data, error } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (error || !data) return 'user';
  return roleFrom((data as { role?: string }).role);
}

export const ADMIN_IN_APP_MESSAGE =
  'This is an administrator account. Administrators sign in on the admin website, not in the app.';
