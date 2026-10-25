/**
 * devLogger.ts — dev diagnostics (guarded by __DEV__)
 * Logs ONLY: stage names | HTTP status codes | elapsed ms.
 * NEVER logs: patient IDs, image paths, tokens, scan IDs, or any PII.
 *
 * To remove before release:
 *   1. Delete services/devLogger.ts
 *   2. Remove the devLog / devLogStart calls from services/analysis.ts
 *   3. Remove the <DevConnectionTest /> usages (components/DevConnectionTest.tsx)
 */

import { config } from '@/services/config';
import { parseHealthResponse } from '@/services/contract';

type Stage =
  | 'resize'
  | 'upload'
  | 'api-call'
  | 'result-load'
  | 'poll'
  | 'status-check'
  | 'skip-upload'
  | 'recover';

interface LogEntry {
  stage: Stage;
  status?: number | string; // HTTP status code or short label only
  elapsedMs?: number;
  note?: string; // Short plain-text only, NO user data
}

const _sessionStart = Date.now();

export function devLog(entry: LogEntry): void {
  if (!__DEV__) return;
  const elapsed = Date.now() - _sessionStart;
  const parts: string[] = [`[DEV] +${elapsed}ms`, `stage=${entry.stage}`];
  if (entry.status !== undefined) parts.push(`status=${entry.status}`);
  if (entry.elapsedMs !== undefined) parts.push(`stepMs=${entry.elapsedMs}`);
  if (entry.note) parts.push(`note="${entry.note}"`);
  console.info(parts.join(' | '));
}

export function devLogStart(): number {
  return Date.now();
}

export interface ServerHealthResult {
  ok: boolean;
  httpStatus: number | null;
  elapsedMs: number;
  device: string | null;
  boneAgeModel: boolean | null;
  boneAgeError: string | null;
  /** Transport or configuration problem, when the server could not be read. */
  error: string | null;
}

/**
 * Dev-only "Test connection": GET {base}/health with a 15 s timeout.
 * Never sends or returns patient data, scan IDs or tokens.
 */
export async function fetchServerHealth(): Promise<ServerHealthResult> {
  const empty = { httpStatus: null, device: null, boneAgeModel: null, boneAgeError: null };
  const start = Date.now();
  if (!__DEV__) return { ok: false, elapsedMs: 0, error: 'Dev builds only', ...empty };
  if (!config.healthUrl) {
    return { ok: false, elapsedMs: 0, error: 'EXPO_PUBLIC_ANALYSIS_API_URL is not configured', ...empty };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(config.healthUrl, { method: 'GET', signal: controller.signal });
    const health = parseHealthResponse(await res.json().catch(() => null));
    return {
      ok: res.ok,
      httpStatus: res.status,
      elapsedMs: Date.now() - start,
      device: health.device,
      boneAgeModel: health.bone_age_model,
      boneAgeError: health.bone_age_error,
      error: null,
    };
  } catch (e: any) {
    const error = controller.signal.aborted ? 'No answer within 15 s' : e?.message ?? 'Unreachable';
    return { ok: false, elapsedMs: Date.now() - start, error, ...empty };
  } finally {
    clearTimeout(timer);
  }
}
