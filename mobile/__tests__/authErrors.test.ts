import { describe, expect, it } from '@jest/globals';
import {
  evaluatePasswordStrength,
  isValidEmail,
  mapAuthError,
} from '@/services/authErrors';

describe('authErrors validation & mapping', () => {
  describe('evaluatePasswordStrength', () => {
    it('classifies short passwords as Weak', () => {
      const res = evaluatePasswordStrength('Aa1!');
      expect(res.hasMinLength).toBe(false);
      expect(res.label).toBe('Weak');
    });

    it('identifies Fair passwords', () => {
      const res = evaluatePasswordStrength('password123');
      expect(res.hasMinLength).toBe(true);
      expect(res.label).toBe('Fair');
    });

    it('identifies Good passwords', () => {
      const res = evaluatePasswordStrength('Password123');
      expect(res.hasMinLength).toBe(true);
      expect(res.hasUpper).toBe(true);
      expect(res.hasLower).toBe(true);
      expect(res.hasNumber).toBe(true);
      expect(res.label).toBe('Good');
    });

    it('identifies Strong passwords', () => {
      const res = evaluatePasswordStrength('Clinician#2026!');
      expect(res.hasMinLength).toBe(true);
      expect(res.hasSpecial).toBe(true);
      expect(res.label).toBe('Strong');
    });
  });

  describe('isValidEmail', () => {
    it('accepts valid email addresses', () => {
      expect(isValidEmail('clinician@hospital.org')).toBe(true);
      expect(isValidEmail('user.name+tag@sub.domain.edu')).toBe(true);
    });

    it('rejects invalid email formats', () => {
      expect(isValidEmail('invalid')).toBe(false);
      expect(isValidEmail('user@')).toBe(false);
      expect(isValidEmail('@hospital.org')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });
  });

  describe('mapAuthError', () => {
    it('maps invalid credentials error', () => {
      const msg = mapAuthError({ message: 'Invalid login credentials' });
      expect(msg).toContain('Incorrect email or password');
    });

    it('maps unconfirmed email error', () => {
      const msg = mapAuthError({ message: 'Email not confirmed' });
      expect(msg).toContain('Your email has not been verified yet');
    });

    it('maps rate limits', () => {
      const msg = mapAuthError({ message: 'over_email_send_rate_limit' });
      expect(msg).toContain('Too many attempts');
    });

    it('maps network errors', () => {
      const msg = mapAuthError({ message: 'Network request failed' });
      expect(msg).toContain('No internet connection');
    });

    it('maps Postgres RLS 42501 specifically as permission denied', () => {
      const msg = mapAuthError({ code: '42501', message: 'violates row-level security policy' });
      expect(msg).toContain('Permission denied');
    });

    it('maps unsupported or unenabled OAuth provider to friendly message', () => {
      const msg = mapAuthError({ message: 'Unsupported provider: provider is not enabled' });
      expect(msg).toContain('Google sign-in is not enabled in your Supabase project settings.');
    });

    it('maps user cancellation', () => {
      const msg = mapAuthError({ message: 'User cancelled flow' });
      expect(msg).toBe('Sign-in was cancelled.');
    });
  });
});
