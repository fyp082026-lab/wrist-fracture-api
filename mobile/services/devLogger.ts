/**
 * devLogger.ts — dev diagnostics (guarded by __DEV__)
 * Logs ONLY: stage names | HTTP status codes | elapsed ms.
 * NEVER logs: patient IDs, image paths, tokens, scan IDs, or any PII.
 *
 * To remove before release:
 *   1. Delete services/devLogger.ts
 *   2. Remove the devLog / devLogStart calls from services/analysis.ts
 */

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
