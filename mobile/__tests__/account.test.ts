import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Res = { data: unknown; error: unknown };
const mockResult = jest.fn<() => Promise<Res>>();
const mockCalls: { table: string; columns: string; id: unknown }[] = [];

jest.mock('@/services/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (_col: string, id: unknown) => ({
          maybeSingle: () => {
            mockCalls.push({ table, columns, id });
            return mockResult();
          },
        }),
      }),
    }),
  },
}));

import { getRole, roleFrom } from '@/services/account';

describe('role-based access (decided in code from profiles.role)', () => {
  beforeEach(() => {
    mockResult.mockReset();
    mockCalls.length = 0;
  });

  it('reads the role column of the signed-in account', async () => {
    mockResult.mockResolvedValue({ data: { role: 'user' }, error: null });
    await getRole('u1');
    expect(mockCalls).toEqual([{ table: 'profiles', columns: 'role', id: 'u1' }]);
  });

  it('admin only when the column says admin', async () => {
    mockResult.mockResolvedValue({ data: { role: 'admin' }, error: null });
    expect(await getRole('u1')).toBe('admin');
  });

  it('user for a normal account', async () => {
    mockResult.mockResolvedValue({ data: { role: 'user' }, error: null });
    expect(await getRole('u1')).toBe('user');
  });

  it('user when the row is missing or the read fails (never locks a user out)', async () => {
    mockResult.mockResolvedValue({ data: null, error: null });
    expect(await getRole('u1')).toBe('user');
    mockResult.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    expect(await getRole('u1')).toBe('user');
  });

  it('only the exact value "admin" grants admin', () => {
    expect(roleFrom('admin')).toBe('admin');
    for (const v of ['Admin', 'ADMIN', 'user', '', null, undefined, 1]) expect(roleFrom(v)).toBe('user');
  });
});
