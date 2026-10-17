/**
 * Single source of runtime configuration (see .planning/CONTRACT.md).
 *
 * Expo only inlines `process.env.EXPO_PUBLIC_*` when accessed by literal name,
 * so each variable is read explicitly below.
 *
 * In development a missing variable throws at startup (red screen), so a broken
 * .env is impossible to miss. In production builds the problems are logged and
 * the affected features fail with friendly errors instead of crashing.
 */

export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Base URL of the analysis server, without a trailing slash or `/analyze`. */
  analysisApiBaseUrl: string;
  analyzeUrl: string;
  healthUrl: string;
}

const HTTP_URL_PATTERN = /^https?:\/\/[^\s/]+/i;

/**
 * Accepts either the base URL or one that already ends in `/analyze`
 * (with or without trailing slashes) and returns the bare base URL.
 */
export function normalizeApiBaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/analyze$/i, '')
    .replace(/\/+$/, '');
}

/** Returns human-readable problems; warnings are prefixed with "Warning:". */
export function validateConfig(env: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  analysisApiUrl: string;
}): string[] {
  const problems: string[] = [];

  if (!env.supabaseUrl) {
    problems.push('EXPO_PUBLIC_SUPABASE_URL is missing.');
  } else if (!HTTP_URL_PATTERN.test(env.supabaseUrl)) {
    problems.push('EXPO_PUBLIC_SUPABASE_URL is not a valid http(s) URL.');
  }

  if (!env.supabaseAnonKey) {
    problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is missing.');
  }

  if (!env.analysisApiUrl) {
    problems.push('EXPO_PUBLIC_ANALYSIS_API_URL is missing.');
  } else if (!HTTP_URL_PATTERN.test(env.analysisApiUrl)) {
    problems.push('EXPO_PUBLIC_ANALYSIS_API_URL is not a valid http(s) URL.');
  } else if (/^http:\/\//i.test(env.analysisApiUrl)) {
    problems.push(
      'Warning: EXPO_PUBLIC_ANALYSIS_API_URL uses http://, so tokens and results travel unencrypted. Use https://.'
    );
  }

  return problems;
}

function loadConfig(): AppConfig {
  const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
  const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  const analysisApiUrl = (process.env.EXPO_PUBLIC_ANALYSIS_API_URL ?? '').trim();

  const problems = validateConfig({ supabaseUrl, supabaseAnonKey, analysisApiUrl });
  const errors = problems.filter((p) => !p.startsWith('Warning:'));
  const warnings = problems.filter((p) => p.startsWith('Warning:'));

  warnings.forEach((w) => console.warn(`[config] ${w}`));

  if (errors.length > 0) {
    const message = `[config] Invalid environment configuration:\n- ${errors.join(
      '\n- '
    )}\nCheck mobile-app/.env (see .env.example) and restart Metro with --clear.`;
    if (__DEV__) {
      throw new Error(message);
    }
    console.error(message);
  }

  const analysisApiBaseUrl = analysisApiUrl ? normalizeApiBaseUrl(analysisApiUrl) : '';

  return {
    supabaseUrl,
    supabaseAnonKey,
    analysisApiBaseUrl,
    analyzeUrl: analysisApiBaseUrl ? `${analysisApiBaseUrl}/analyze` : '',
    healthUrl: analysisApiBaseUrl ? `${analysisApiBaseUrl}/health` : '',
  };
}

export const config: AppConfig = loadConfig();
