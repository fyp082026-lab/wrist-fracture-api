/**
 * Typed mirror of .planning/CONTRACT.md: the analysis API and the Supabase rows
 * the app reads. Every response or row that crosses the network goes through a
 * parser here, so a malformed payload fails with a clear ContractError instead
 * of crashing a screen or rendering something invented.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

export const STORAGE_BUCKET = 'wrist-xrays';

/**
 * Fracture findings below this confidence are labelled "Lower confidence,
 * review carefully". A UI review prompt, not a validated clinical cut-off.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.65;

export const DEFAULT_CLINICAL_DISCLAIMER =
  'AI-assisted finding. Decision support only, not a diagnosis.';

// ─── Shared types ────────────────────────────────────────────────────────────

export type PatientSex = 'M' | 'F';
export type FractureType = 'Growth-Plate' | 'Shaft';
/** `scans.status` values. The server owns `analyzing` and `completed`. */
export type ScanStatus = 'uploaded' | 'analyzing' | 'completed' | 'failed';
/** Display classification derived from a completed result. */
export type FindingStatus = 'fracture_detected' | 'no_fracture' | 'low_confidence';

/** [x1, y1, x2, y2] as 0–1 fractions of image width / height. */
export type BoxNormalized = [number, number, number, number];

export interface Detection {
  label: string;
  confidence: number;
  box_normalized: BoxNormalized;
}

export interface AnalyzeRequest {
  scan_id: string;
  image_path: string;
  patient_age_months: number;
  patient_sex: PatientSex;
}

export interface AnalyzeResponse {
  scan_id: string;
  status: 'completed';
  fracture_detected: boolean;
  fracture_type: FractureType | null;
  confidence: number | null;
  detections: Detection[];
  bone_age_months: number | null;
  bone_age_formatted: string | null;
  chronological_age_formatted: string;
  grad_cam_path: string | null;
  clinical_disclaimer: string;
}

/** Row of `analysis_results` as read by the client (never written by it). */
export interface AnalysisResultRow {
  scan_id: string;
  fracture_detected: boolean;
  fracture_type: FractureType | null;
  confidence: number | null;
  detections: Detection[];
  bone_age_months: number | null;
  grad_cam_path: string | null;
  clinical_disclaimer: string | null;
  created_at: string | null;
}

export interface HealthResponse {
  device: string | null;
  bone_age_model: boolean | null;
  bone_age_error: string | null;
}

// ─── Validation primitives ───────────────────────────────────────────────────

export class ContractError extends Error {
  /** Dotted path of the offending field, e.g. `detections[0].box_normalized`. */
  field: string;

  constructor(field: string, problem: string) {
    super(`Malformed analysis data: "${field}" ${problem}`);
    this.name = 'ContractError';
    this.field = field;
  }
}

type Json = Record<string, unknown>;

function asObject(value: unknown, field: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ContractError(field, 'must be an object');
  }
  return value as Json;
}

function requireString(obj: Json, key: string, path: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ContractError(path + key, 'must be a non-empty string');
  }
  return v;
}

/** Nullable fields may be null or absent (absent is read as null). */
function nullableString(obj: Json, key: string, path: string): string | null {
  const v = obj[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new ContractError(path + key, 'must be a string or null');
  return v;
}

function requireBoolean(obj: Json, key: string, path: string): boolean {
  const v = obj[key];
  if (typeof v !== 'boolean') throw new ContractError(path + key, 'must be a boolean');
  return v;
}

/** Accepts finite numbers, or numeric strings (Postgres NUMERIC can arrive as text). */
function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function nullableNumber(
  obj: Json,
  key: string,
  path: string,
  range?: { min: number; max: number }
): number | null {
  const v = obj[key];
  if (v === null || v === undefined) return null;
  const n = toFiniteNumber(v);
  if (n === null) throw new ContractError(path + key, 'must be a number or null');
  if (range && (n < range.min || n > range.max)) {
    throw new ContractError(path + key, `must be between ${range.min} and ${range.max}`);
  }
  return n;
}

function parseFractureType(obj: Json, path: string): FractureType | null {
  const v = obj.fracture_type;
  if (v === null || v === undefined) return null;
  if (v === 'Growth-Plate' || v === 'Shaft') return v;
  throw new ContractError(path + 'fracture_type', 'must be "Growth-Plate", "Shaft" or null');
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

export function parseDetection(value: unknown, field = 'detection'): Detection {
  const obj = asObject(value, field);
  const label = requireString(obj, 'label', `${field}.`);
  const confidence = toFiniteNumber(obj.confidence);
  if (confidence === null || confidence < 0 || confidence > 1) {
    throw new ContractError(`${field}.confidence`, 'must be a number between 0 and 1');
  }

  const box = obj.box_normalized;
  if (!Array.isArray(box) || box.length !== 4) {
    throw new ContractError(`${field}.box_normalized`, 'must be an array [x1, y1, x2, y2]');
  }
  const nums = box.map(toFiniteNumber);
  if (nums.some((n) => n === null || n < 0 || n > 1)) {
    throw new ContractError(`${field}.box_normalized`, 'values must be numbers between 0 and 1');
  }
  const [x1, y1, x2, y2] = nums as number[];
  if (x2 <= x1 || y2 <= y1) {
    throw new ContractError(`${field}.box_normalized`, 'must satisfy x1 < x2 and y1 < y2');
  }

  return { label, confidence, box_normalized: [x1, y1, x2, y2] };
}

/** Accepts an array, or a JSON string of one (jsonb can arrive serialised). */
export function parseDetections(value: unknown, field = 'detections'): Detection[] {
  let raw = value;
  if (raw === null || raw === undefined) return [];
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new ContractError(field, 'is not valid JSON');
    }
  }
  if (!Array.isArray(raw)) throw new ContractError(field, 'must be an array');
  return raw.map((d, i) => parseDetection(d, `${field}[${i}]`));
}

/**
 * Validates a `POST /analyze` success body.
 * @param expectedScanId when given, the response must refer to this scan.
 */
export function parseAnalyzeResponse(json: unknown, expectedScanId?: string): AnalyzeResponse {
  const obj = asObject(json, 'response');

  const scan_id = requireString(obj, 'scan_id', '');
  if (expectedScanId && scan_id !== expectedScanId) {
    throw new ContractError('scan_id', 'does not match the scan that was submitted');
  }
  if (obj.status !== 'completed') {
    throw new ContractError('status', `must be "completed" (got ${JSON.stringify(obj.status)})`);
  }
  if (!Array.isArray(obj.detections) && obj.detections !== undefined) {
    throw new ContractError('detections', 'must be an array');
  }

  return {
    scan_id,
    status: 'completed',
    fracture_detected: requireBoolean(obj, 'fracture_detected', ''),
    fracture_type: parseFractureType(obj, ''),
    confidence: nullableNumber(obj, 'confidence', '', { min: 0, max: 1 }),
    detections: parseDetections(obj.detections ?? []),
    bone_age_months: nullableNumber(obj, 'bone_age_months', '', { min: 0, max: 300 }),
    bone_age_formatted: nullableString(obj, 'bone_age_formatted', ''),
    chronological_age_formatted: requireString(obj, 'chronological_age_formatted', ''),
    grad_cam_path: nullableString(obj, 'grad_cam_path', ''),
    clinical_disclaimer: requireString(obj, 'clinical_disclaimer', ''),
  };
}

export function parseAnalysisResultRow(row: unknown): AnalysisResultRow {
  const obj = asObject(row, 'analysis_results');
  const p = 'analysis_results.';
  // Support both actual Supabase column 'fracture_confidence' and alias/contract 'confidence'
  const rawConfidence =
    obj.fracture_confidence !== undefined ? obj.fracture_confidence : obj.confidence;
  // Support both actual Supabase column 'gradcam_path' and alias/contract 'grad_cam_path'
  const rawGradCam =
    obj.gradcam_path !== undefined ? obj.gradcam_path : obj.grad_cam_path;

  return {
    scan_id: requireString(obj, 'scan_id', p),
    fracture_detected: requireBoolean(obj, 'fracture_detected', p),
    fracture_type: parseFractureType(obj, p),
    confidence: nullableNumber({ confidence: rawConfidence }, 'confidence', p, { min: 0, max: 1 }),
    detections: parseDetections(obj.detections, `${p}detections`),
    bone_age_months: nullableNumber(obj, 'bone_age_months', p, { min: 0, max: 300 }),
    grad_cam_path: nullableString({ grad_cam_path: rawGradCam }, 'grad_cam_path', p),
    clinical_disclaimer: nullableString(obj, 'clinical_disclaimer', p),
    created_at: nullableString(obj, 'created_at', p),
  };
}

/** Lenient: unknown keys are ignored, missing ones become null. */
export function parseHealthResponse(json: unknown): HealthResponse {
  const obj = typeof json === 'object' && json !== null ? (json as Json) : {};
  return {
    device: typeof obj.device === 'string' ? obj.device : null,
    bone_age_model: typeof obj.bone_age_model === 'boolean' ? obj.bone_age_model : null,
    bone_age_error: typeof obj.bone_age_error === 'string' ? obj.bone_age_error : null,
  };
}

// ─── Derived helpers ─────────────────────────────────────────────────────────

export function deriveFindingStatus(
  fractureDetected: boolean,
  confidence: number | null
): FindingStatus {
  if (!fractureDetected) return 'no_fracture';
  return confidence != null && confidence < LOW_CONFIDENCE_THRESHOLD
    ? 'low_confidence'
    : 'fracture_detected';
}

/** 97.4 → "8y 1m". Months are floored so fractional ages never render as "1.4m". */
export function formatAgeMonths(totalMonths: number): string {
  const whole = Math.max(0, Math.floor(totalMonths));
  return `${Math.floor(whole / 12)}y ${whole % 12}m`;
}

export function buildImagePath(userId: string, scanId: string): string {
  return `${userId}/${scanId}.jpg`;
}
