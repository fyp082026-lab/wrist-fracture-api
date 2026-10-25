import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@/services/supabase', () => ({ supabase: {} }));
import { effectiveStatus, summarize, type ScanListItem } from '@/services/records';

const scan = (status: ScanListItem['status'], fracture?: boolean): ScanListItem => ({
  id: Math.random().toString(36),
  status,
  mode: 'both',
  created_at: '2026-10-17T10:00:00Z',
  image_path: 'u/s.jpg',
  patient: null,
  result: fracture === undefined ? null : { fracture_detected: fracture, confidence: 0.9, bone_age_months: 100 },
});

describe('summarize', () => {
  it('counts statuses and suggested fractures', () => {
    const s = summarize([scan('completed', true), scan('completed', false), scan('analyzing'), scan('uploaded'), scan('failed')]);
    expect(s).toEqual({ total: 5, completed: 2, fractures: 1, pending: 2, failed: 1 });
  });
  it('handles an empty history', () => {
    expect(summarize([])).toEqual({ total: 0, completed: 0, fractures: 0, pending: 0, failed: 0 });
  });
});

describe('effectiveStatus', () => {
  it('shows a scan with a saved result as completed, whatever its status column says', () => {
    expect(effectiveStatus('failed', true)).toBe('completed');
    expect(effectiveStatus('analyzing', true)).toBe('completed');
  });

  it('keeps the stored status when there is no result', () => {
    expect(effectiveStatus('failed', false)).toBe('failed');
    expect(effectiveStatus('uploaded', false)).toBe('uploaded');
  });
});
