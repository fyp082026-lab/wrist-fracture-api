/**
 * Authentication state for the whole app (Supabase email + password).
 *
 * - The session is persisted (Keychain / Keystore) and refreshed automatically,
 *   so users stay signed in between launches.
 * - Role-based access (decided here, in code, from profiles.role): administrator
 *   accounts are signed out of the app and sent to the admin website; only
 *   role 'user' can use the app.
 * - Email confirmation and password-reset links come back as deep links; the
 *   code in them is exchanged for a session here.
 *
 * FLOW: app/_layout.tsx wraps the whole app in <AuthProvider>. Screens call
 * useAuth() to read `session`, `profile`, `role` and to call signIn / signUp /
 * signOut ... Each action talks to Supabase and returns { ok } or { ok: false,
 * error } to the screen, which shows the error text. app/_layout.tsx reads
 * `session` and `role` to decide between the sign-in screens and the main app.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/app_logic/supabase';
import { isValidEmail, mapAuthError } from '@/app_logic/authErrors';
import { parseAuthUrl } from '@/app_logic/authLinks';
import {
  ADMIN_IN_APP_MESSAGE,
  type Role,
  type UserProfile,
  getProfile,
  getRole,
  saveProfile,
} from '@/app_logic/account';

const APP_SCHEME = 'pediafracture';

/**
 * Where Supabase sends email links back to. Installed builds use the app
 * scheme; Expo Go uses exp://<host>/--/<path>; the web build uses its origin.
 * Each form must be listed under Supabase > Authentication > Redirect URLs.
 * Result goes to: signUp, resendVerification and sendPasswordReset below, which
 * hand it to Supabase as the address to put in the email.
 */
export function authRedirectUrl(path: 'auth/callback' | 'reset-password'): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}/${path}`;
  }
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return Linking.createURL(path);
  }
  return `${APP_SCHEME}://${path}`;
}

// What every action returns to the screen that called it: success, or a message to display.
type Result = { ok: true } | { ok: false; error: string };
type SignInResult = Result | { ok: false; error: string; unverified: true };

/** Everything useAuth() gives to a screen. */
interface AuthState {
  session: Session | null;
  profile: UserProfile | null;
  /** 'user' once the signed-in account is confirmed not to be an admin; null while checking. */
  role: Role | null;
  /** True until the stored session has been read on launch. */
  initializing: boolean;
  /** Set while a password-reset link is being completed. */
  recovering: boolean;
  /** Message from a redirect that could not be completed (shown on sign-in). */
  linkMessage: string | null;
  clearLinkMessage: () => void;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  signUp: (input: { email: string; password: string; fullName: string; organisation: string }) => Promise<
    Result & { needsVerification?: boolean }
  >;
  resendVerification: (email: string) => Promise<Result>;
  sendPasswordReset: (email: string) => Promise<Result>;
  updatePassword: (password: string) => Promise<Result>;
  updateProfile: (fields: { full_name: string; organisation: string }) => Promise<Result>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Holds the sign-in state and provides it (plus the actions) to every screen below it. */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const handledCodes = useRef(new Set<string>());

  // Loads (or creates) the user's profile row with account.ts. Result goes to: `profile`,
  // shown on the Home and Profile screens.
  const loadProfile = useCallback(async (s: Session) => {
    try {
      const row = await getProfile(s.user.id);
      if (row) {
        setProfile(row);
        return;
      }
      // First sign-in and no database trigger: create it from sign-up metadata.
      const meta = s.user.user_metadata ?? {};
      setProfile(
        await saveProfile({ id: s.user.id, full_name: meta.full_name ?? null, organisation: meta.hospital ?? null })
      );
    } catch {
      // Profile problems never block using the app; Profile screen can retry.
      setProfile((p) => p ?? { id: s.user.id, full_name: s.user.user_metadata?.full_name ?? null, organisation: null, role: 'user' });
    }
  }, []);

  // Role-based access: only role 'user' may use the app.
  const checkRole = useCallback(
    async (s: Session) => {
      const r = await getRole(s.user.id);
      if (r === 'admin') {
        setLinkMessage(ADMIN_IN_APP_MESSAGE);
        await supabase.auth.signOut({ scope: 'local' });
        return;
      }
      setRole('user');
      loadProfile(s);
    },
    [loadProfile]
  );

  // Listen to Supabase: every sign-in, sign-out or token refresh updates `session`, and a
  // new sign-in triggers the role check above.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setInitializing(false);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (!s) {
        setProfile(null);
        setRole(null);
        setRecovering(false);
      } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        setRole(null);
        // Deferred: Supabase queries must not run inside this callback.
        setTimeout(() => checkRole(s), 0);
      } else if (event === 'USER_UPDATED') {
        setTimeout(() => loadProfile(s), 0);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [checkRole, loadProfile]);

  // Email confirmation / password reset links.
  useEffect(() => {
    // Handles a link that opened the app: reads it with authLinks.parseAuthUrl(), then asks
    // Supabase to turn the code / tokens into a session. Problems go to `linkMessage`,
    // which the sign-in screen displays.
    const handle = async (url: string | null) => {
      if (!url) return;
      const p = parseAuthUrl(url);
      const isReset = url.includes('reset-password') || p.type === 'recovery';
      if (p.error) {
        setLinkMessage(
          /expired|invalid/i.test(p.error)
            ? 'That link has expired or was already used. Request a new one.'
            : p.error
        );
        return;
      }
      if (p.code) {
        if (handledCodes.current.has(p.code)) return;
        handledCodes.current.add(p.code);
        if (isReset) setRecovering(true);
        const { error } = await supabase.auth.exchangeCodeForSession(p.code);
        if (error) {
          setRecovering(false);
          // The email is confirmed by Supabase before it redirects, even when the
          // code cannot be redeemed here (e.g. opened on a different device).
          setLinkMessage(
            isReset
              ? 'This reset link could not be used on this device. Request a new one from this phone.'
              : 'Your email is confirmed. Please sign in.'
          );
        }
        return;
      }
      if (p.accessToken && p.refreshToken) {
        if (isReset) setRecovering(true);
        const { error } = await supabase.auth.setSession({
          access_token: p.accessToken,
          refresh_token: p.refreshToken,
        });
        if (error) setLinkMessage(mapAuthError(error));
      }
    };
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);

  // Called by the sign-in screen. Success creates a session (picked up by the listener above);
  // failure returns the message for the screen to show.
  const signIn = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    const clean = email.trim().toLowerCase();
    if (!isValidEmail(clean)) return { ok: false, error: 'Please enter a valid email address.' };
    if (!password) return { ok: false, error: 'Please enter your password.' };
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: clean, password });
      if (!error) return { ok: true };
      if (error.code === 'email_not_confirmed' || /not confirmed/i.test(error.message)) {
        return { ok: false, error: mapAuthError(error), unverified: true };
      }
      return { ok: false, error: mapAuthError(error) };
    } catch (e) {
      return { ok: false, error: mapAuthError(e) };
    }
  }, []);

  // Called by the sign-up screen. Creates the account; Supabase emails a verification link.
  // needsVerification tells the screen to open the "check your email" screen.
  const signUp: AuthState['signUp'] = useCallback(async ({ email, password, fullName, organisation }) => {
    const clean = email.trim().toLowerCase();
    if (!fullName.trim()) return { ok: false, error: 'Please enter your full name.' };
    if (!isValidEmail(clean)) return { ok: false, error: 'Please enter a valid email address.' };
    if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
    try {
      const { data, error } = await supabase.auth.signUp({
        email: clean,
        password,
        options: {
          data: { full_name: fullName.trim(), hospital: organisation.trim() || null },
          emailRedirectTo: authRedirectUrl('auth/callback'),
        },
      });
      if (error) return { ok: false, error: mapAuthError(error) };
      // Supabase returns a user with no identities when the email is already registered.
      if (data.user && (data.user.identities?.length ?? 1) === 0) {
        return { ok: false, error: 'An account with this email already exists. Try signing in.' };
      }
      return { ok: true, needsVerification: !data.session };
    } catch (e) {
      return { ok: false, error: mapAuthError(e) };
    }
  }, []);

  // Called by the verify-email screen: sends the verification email again.
  const resendVerification = useCallback(async (email: string): Promise<Result> => {
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: authRedirectUrl('auth/callback') },
      });
      return error ? { ok: false, error: mapAuthError(error) } : { ok: true };
    } catch (e) {
      return { ok: false, error: mapAuthError(e) };
    }
  }, []);

  // Called by the forgot-password and Profile screens: emails a reset link that opens app/reset-password.tsx.
  const sendPasswordReset = useCallback(async (email: string): Promise<Result> => {
    const clean = email.trim().toLowerCase();
    if (!isValidEmail(clean)) return { ok: false, error: 'Please enter a valid email address.' };
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(clean, {
        redirectTo: authRedirectUrl('reset-password'),
      });
      return error ? { ok: false, error: mapAuthError(error) } : { ok: true };
    } catch (e) {
      return { ok: false, error: mapAuthError(e) };
    }
  }, []);

  // Called by the reset-password screen: saves the new password and ends recovery mode.
  const updatePassword = useCallback(async (password: string): Promise<Result> => {
    if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return { ok: false, error: mapAuthError(error) };
      setRecovering(false);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: mapAuthError(e) };
    }
  }, []);

  // Called by the Profile screen: saves name and organisation with account.saveProfile()
  // and updates `profile` for every screen.
  const updateProfile = useCallback(
    async (fields: { full_name: string; organisation: string }): Promise<Result> => {
      if (!session) return { ok: false, error: 'You are signed out.' };
      try {
        setProfile(await saveProfile({ id: session.user.id, ...fields }));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    [session]
  );

  // Called by the Profile screen: clears the session; app/_layout.tsx then shows the sign-in screen.
  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } finally {
      setSession(null);
      setProfile(null);
      setRole(null);
    }
  }, []);

  // Called by the sign-in screen once it has shown a link message.
  const clearLinkMessage = useCallback(() => setLinkMessage(null), []);

  // Everything above, bundled into the one object that useAuth() returns.
  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      role,
      initializing,
      recovering,
      linkMessage,
      clearLinkMessage,
      signIn,
      signUp,
      resendVerification,
      sendPasswordReset,
      updatePassword,
      updateProfile,
      signOut,
    }),
    [session, profile, role, initializing, recovering, linkMessage, clearLinkMessage, signIn, signUp,
      resendVerification, sendPasswordReset, updatePassword, updateProfile, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** How a screen gets the sign-in state and actions: `const { session, signIn } = useAuth()`. */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
