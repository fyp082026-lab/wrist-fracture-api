import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockRpc = jest.fn<(fn: string) => Promise<{ data: unknown; error: unknown }>>();
jest.mock('@/services/supabase', () => ({ supabase: { rpc: (fn: string) => mockRpc(fn) } }));

import { getRole } from '@/services/account';

describe('getRole (role-based access)', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('asks the database is_admin() function', async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    await getRole();
    expect(mockRpc).toHaveBeenCalledWith('is_admin');
  });

  it('returns admin only when is_admin() is true', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    expect(await getRole()).toBe('admin');
  });

  it('returns user for a normal account', async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    expect(await getRole()).toBe('user');
  });

  it('does not lock users out when the check fails (e.g. offline)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    expect(await getRole()).toBe('user');
  });
});
