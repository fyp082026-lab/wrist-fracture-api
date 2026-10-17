/**
 * Maps Supabase Auth errors and PostgreSQL codes to user-friendly clinical messages.
 * Never exposes raw JSON or internal database stack traces to the user.
 */
export function mapAuthError(error: unknown): string {
  if (!error) return 'An unexpected error occurred. Please try again.';

  const err = error as { code?: string; message?: string; status?: number };
  const message = (err.message || '').toLowerCase();
  const code = (err.code || '').toLowerCase();

  // Network / Offline errors
  if (
    /network request failed|failed to fetch|offline|internet|connection/.test(
      message
    )
  ) {
    return 'No internet connection. Please check your network and try again.';
  }

  // Credentials
  if (
    message.includes('invalid login credentials') ||
    message.includes('invalid credentials') ||
    code === 'invalid_credentials'
  ) {
    return 'Incorrect email or password. Please check your details and try again.';
  }

  // Unconfirmed email
  if (
    message.includes('email not confirmed') ||
    code === 'email_not_confirmed'
  ) {
    return 'Your email has not been verified yet. Please check your inbox or request a new link.';
  }

  // User already exists
  if (
    message.includes('user already registered') ||
    message.includes('already exists') ||
    code === 'user_already_exists'
  ) {
    return 'An account with this email already exists. Try signing in or resetting your password.';
  }

  // Rate limits
  if (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('over_email_send_rate_limit') ||
    code === 'over_email_send_rate_limit' ||
    err.status === 429
  ) {
    return 'Too many attempts. For security reasons, please wait a minute before trying again.';
  }

  // Password rules
  if (
    message.includes('password should be') ||
    message.includes('weak password')
  ) {
    return 'Password must be at least 8 characters and include uppercase, lowercase, and numbers.';
  }

  // Expired link / invalid token
  if (
    message.includes('token has expired') ||
    message.includes('otp expired') ||
    message.includes('invalid token')
  ) {
    return 'This verification link has expired or has already been used. Please request a new one.';
  }

  // PKCE: the code was already used, has expired, or the code verifier saved on
  // this device is missing (e.g. the link was opened on another device).
  if (
    message.includes('flow state') ||
    message.includes('code verifier') ||
    message.includes('auth code') ||
    code === 'flow_state_not_found' ||
    code === 'flow_state_expired' ||
    code === 'bad_code_verifier'
  ) {
    return 'This sign-in attempt expired or was already used. Please try again from this device.';
  }

  // A database trigger on auth.users failed while creating the account.
  if (message.includes('database error saving new user')) {
    return 'Your account could not be created on the server. Please contact the administrator.';
  }

  // OAuth / Provider errors
  if (
    code === 'access_denied' ||
    message.includes('access_denied') ||
    message.includes('access denied')
  ) {
    return 'Sign-in was cancelled.';
  }

  if (
    message.includes('provider is not enabled') ||
    message.includes('unsupported provider')
  ) {
    return 'Google sign-in is not enabled in your Supabase project settings.';
  }

  if (message.includes('cancelled') || message.includes('canceled') || code === 'user_cancelled') {
    return 'Sign-in was cancelled.';
  }

  // PostgreSQL RLS 42501 (Permission Denied, not Session Expired!)
  if (err.code === '42501') {
    return 'Permission denied by database security policy. Please contact your system administrator.';
  }

  return err.message || 'Authentication failed. Please try again.';
}

export interface PasswordStrength {
  score: number; // 0 to 4
  label: 'Weak' | 'Fair' | 'Good' | 'Strong';
  hasMinLength: boolean;
  hasUpper: boolean;
  hasLower: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  const hasMinLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  // If minimum length is not met, strength is always Weak
  if (!hasMinLength) {
    return {
      score: 1,
      label: 'Weak',
      hasMinLength,
      hasUpper,
      hasLower,
      hasNumber,
      hasSpecial,
    };
  }

  let score = 1;
  if (hasUpper && hasLower) score++;
  if (hasNumber) score++;
  if (hasSpecial || password.length >= 12) score++;

  let label: PasswordStrength['label'] = 'Weak';
  if (score === 2) label = 'Fair';
  else if (score === 3) label = 'Good';
  else if (score >= 4) label = 'Strong';

  return {
    score,
    label,
    hasMinLength,
    hasUpper,
    hasLower,
    hasNumber,
    hasSpecial,
  };
}

export function isValidEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim().toLowerCase());
}
