import { describe, expect, it } from '@jest/globals';
import { parseAuthUrl } from '@/services/authLinks';

describe('parseAuthUrl', () => {
  it('reads a PKCE code from the query', () => {
    expect(parseAuthUrl('pediafracture://auth/callback?code=abc123').code).toBe('abc123');
  });
  it('reads tokens and type from the fragment', () => {
    const p = parseAuthUrl('pediafracture://reset-password#access_token=AT&refresh_token=RT&type=recovery');
    expect(p).toMatchObject({ accessToken: 'AT', refreshToken: 'RT', type: 'recovery', code: null });
  });
  it('reads Expo Go style URLs with a query and a fragment', () => {
    const p = parseAuthUrl('exp://192.168.1.2:8081/--/auth/callback?code=c1#type=signup');
    expect(p.code).toBe('c1');
    expect(p.type).toBe('signup');
  });
  it('prefers error_description over error', () => {
    const p = parseAuthUrl('pediafracture://auth/callback?error=access_denied&error_description=Email+link+is+invalid+or+has+expired');
    expect(p.error).toBe('Email link is invalid or has expired');
  });
  it('returns nulls for a plain deep link', () => {
    expect(parseAuthUrl('pediafracture://home')).toEqual({ code: null, accessToken: null, refreshToken: null, type: null, error: null });
  });
});
