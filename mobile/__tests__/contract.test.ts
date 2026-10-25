import { describe, expect, it } from '@jest/globals';
import {
  ContractError,
  LOW_CONFIDENCE_THRESHOLD,
  deriveFindingStatus,
  formatAgeMonths,
  parseAnalysisResultRow,
  parseAnalyzeResponse,
} from '@/services/contract';

const valid = {
  scan_id: 's1',
  status: 'completed',
  fracture_detected: true,
  fracture_type: null,
  confidence: 0.87,
  detections: [{ label: 'Fracture', confidence: 0.87, box_normalized: [0.41, 0.52, 0.58, 0.66] }],
  bone_age_months: 97.4,
  bone_age_formatted: '8y 1m',
  chronological_age_formatted: '8y 4m',
  grad_cam_path: null,
  clinical_disclaimer: 'AI-assisted finding. Decision support only, not a diagnosis.',
};

function rejectedField(json: unknown, expectedScanId?: string): string {
  try {
    parseAnalyzeResponse(json, expectedScanId);
  } catch (err) {
    if (err instanceof ContractError) return err.field;
    throw err;
  }
  throw new Error('expected a ContractError');
}

describe('parseAnalyzeResponse', () => {
  it('accepts the flat contract shape with array boxes', () => {
    const parsed = parseAnalyzeResponse(valid, 's1');
    expect(parsed.detections[0].box_normalized).toEqual([0.41, 0.52, 0.58, 0.66]);
    expect(parsed.fracture_type).toBeNull();
  });

  it('reads absent nullable fields as null', () => {
    const { grad_cam_path, bone_age_months, ...rest } = valid;
    const parsed = parseAnalyzeResponse(rest);
    expect(parsed.grad_cam_path).toBeNull();
    expect(parsed.bone_age_months).toBeNull();
  });

  it('accepts a negative finding with null confidence and no detections', () => {
    const parsed = parseAnalyzeResponse({ ...valid, fracture_detected: false, confidence: null, detections: [] });
    expect(parsed.confidence).toBeNull();
    expect(parsed.detections).toEqual([]);
  });

  it.each([
    ['object-style boxes', { ymin: 0.1 }],
    ['boxes far outside 0..1', [0.1, 0.1, 1.4, 0.2]],
    ['inverted boxes', [0.5, 0.1, 0.2, 0.2]],
    ['zero-width boxes', [0.5, 0.1, 0.5, 0.2]],
  ])('drops only the unusable box (%s) and keeps the result', (_name, badBox) => {
    const good = valid.detections[0];
    const parsed = parseAnalyzeResponse({
      ...valid,
      detections: [{ label: 'Fracture', confidence: 0.9, box_normalized: badBox }, good],
    });
    expect(parsed.fracture_detected).toBe(true);
    expect(parsed.detections).toEqual([good]);
  });

  it('clamps box edges that are only rounding noise past the border', () => {
    const parsed = parseAnalyzeResponse({
      ...valid,
      detections: [{ label: 'Fracture', confidence: 0.7, box_normalized: [-0.001, 0.1, 1.0000001, 0.2] }],
    });
    expect(parsed.detections[0].box_normalized).toEqual([0, 0.1, 1, 0.2]);
  });

  it.each([-3.2, 301])('shows an implausible bone age (%s) as not available', (age) => {
    const parsed = parseAnalyzeResponse({ ...valid, bone_age_months: age });
    expect(parsed.bone_age_months).toBeNull();
    expect(parsed.fracture_detected).toBe(true);
  });

  it.each([
    ['the old nested shape', { status: 'success', scan_id: 's1', fracture_analysis: {} }, 'status'],
    ['confidence above 1', { ...valid, confidence: 87 }, 'confidence'],
    ['an unknown fracture_type', { ...valid, fracture_type: 'Buckle' }, 'fracture_type'],
    ['an empty disclaimer', { ...valid, clinical_disclaimer: '' }, 'clinical_disclaimer'],
  ])('rejects %s', (_name, json, field) => {
    expect(rejectedField(json)).toBe(field);
  });

  it('rejects a response for a different scan', () => {
    expect(rejectedField(valid, 'other-scan')).toBe('scan_id');
  });
});

describe('parseAnalysisResultRow', () => {
  it('accepts NUMERIC columns as strings and jsonb detections as text', () => {
    const row = parseAnalysisResultRow({
      scan_id: 's1',
      fracture_detected: true,
      fracture_type: null,
      confidence: '0.8700',
      detections: JSON.stringify(valid.detections),
      bone_age_months: '97.40',
      grad_cam_path: null,
      clinical_disclaimer: null,
      created_at: '2026-10-15T10:00:00Z',
    });
    expect(row.confidence).toBe(0.87);
    expect(row.bone_age_months).toBe(97.4);
    expect(row.detections).toHaveLength(1);
  });

  it('accepts live database columns fracture_confidence and gradcam_path', () => {
    const row = parseAnalysisResultRow({
      scan_id: 's2',
      fracture_detected: true,
      fracture_confidence: '0.9200',
      bone_age_months: 110,
      gradcam_path: 'user/scan2_cam.jpg',
    });
    expect(row.confidence).toBe(0.92);
    expect(row.grad_cam_path).toBe('user/scan2_cam.jpg');
  });

  it('reads a row exactly as the live table returns it (select *)', () => {
    const row = parseAnalysisResultRow({
      id: 'r1', scan_id: 's3', user_id: 'u1', fracture_detected: true,
      fracture_confidence: 0.83, confidence: 0.83, low_confidence: false, model_version: null,
      gradcam_path: null, grad_cam_path: null, fracture_type: null,
      detections: [{ label: 'Fracture', confidence: 0.83, box_normalized: [0.41, 0.52, 0.55, 0.66] }],
      bone_age_months: 104.37, clinical_disclaimer: 'AI-assisted finding.', created_at: '2026-10-21T05:47:10+00:00',
    });
    expect(row.confidence).toBe(0.83);
    expect(row.detections).toHaveLength(1);
    expect(row.bone_age_months).toBe(104.37);
  });

  it('uses the original column when the newer one is empty', () => {
    const row = parseAnalysisResultRow({ scan_id: 's4', fracture_detected: true, confidence: null, fracture_confidence: 0.6 });
    expect(row.confidence).toBe(0.6);
  });
});

describe('lower-confidence threshold', () => {
  it('is a single 0.65 constant', () => {
    expect(LOW_CONFIDENCE_THRESHOLD).toBe(0.65);
  });

  it('classifies findings around the threshold', () => {
    expect(deriveFindingStatus(true, 0.64)).toBe('low_confidence');
    expect(deriveFindingStatus(true, 0.65)).toBe('fracture_detected');
    expect(deriveFindingStatus(true, null)).toBe('fracture_detected');
    expect(deriveFindingStatus(false, null)).toBe('no_fracture');
  });
});

describe('formatAgeMonths', () => {
  it('floors fractional months', () => {
    expect(formatAgeMonths(97.4)).toBe('8y 1m');
    expect(formatAgeMonths(100)).toBe('8y 4m');
  });
});
