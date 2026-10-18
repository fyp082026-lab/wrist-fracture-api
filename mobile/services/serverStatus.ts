import { config } from '@/services/config';

export type ServerState = 'online' | 'degraded' | 'offline';

/**
 * Reads GET /health in every build type (devLogger's version is dev-only).
 * 'degraded' means the server is up but cannot reach Supabase, so sign-in
 * checks and analysis will fail until its key is fixed.
 */
export async function checkServer(timeoutMs = 10_000): Promise<{ state: ServerState; detail: string | null }> {
  if (!config.healthUrl) return { state: 'offline', detail: 'Server URL not configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(config.healthUrl, { signal: controller.signal });
    if (!res.ok) return { state: 'offline', detail: `HTTP ${res.status}` };
    const body = (await res.json().catch(() => null)) as { status?: string; supabase_error?: string | null } | null;
    if (body?.status && body.status !== 'ready') {
      return { state: 'degraded', detail: body.supabase_error ?? 'Server is not fully ready' };
    }
    return { state: 'online', detail: null };
  } catch {
    return { state: 'offline', detail: 'Unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
