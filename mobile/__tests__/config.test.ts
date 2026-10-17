import { describe, expect, it } from '@jest/globals';
// Env placeholders are set in __tests__/setup-env.js (the legacy .../analyze/ form).
import { config, normalizeApiBaseUrl, validateConfig } from '@/services/config';

describe('normalizeApiBaseUrl', () => {
  it.each([
    'https://a.example',
    'https://a.example/',
    'https://a.example/analyze',
    'https://a.example/analyze/',
    '  https://a.example//analyze// ',
  ])('normalises %j to the base URL', (raw) => {
    expect(normalizeApiBaseUrl(raw)).toBe('https://a.example');
  });
});

describe('config', () => {
  it('builds /analyze and /health from a legacy .../analyze value', () => {
    expect(config.analyzeUrl).toBe('https://api.example.com/analyze');
    expect(config.healthUrl).toBe('https://api.example.com/health');
  });
});

describe('validateConfig', () => {
  it('reports every missing variable', () => {
    expect(validateConfig({ supabaseUrl: '', supabaseAnonKey: '', analysisApiUrl: '' })).toHaveLength(3);
  });

  it('warns (but does not fail) on an http:// analysis URL', () => {
    const problems = validateConfig({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'k',
      analysisApiUrl: 'http://203.0.113.10',
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^Warning: .*http:\/\//);
  });

  it('accepts a complete https configuration', () => {
    expect(
      validateConfig({
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'k',
        analysisApiUrl: 'https://api.example.com',
      })
    ).toEqual([]);
  });
});
