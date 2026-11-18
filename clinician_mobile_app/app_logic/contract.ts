/**
 * Typed mirror of .planning/CONTRACT.md: the analysis API and the Supabase rows
 * the app reads. Every response or row that crosses the network goes through a
 * parser here, so a malformed payload fails with a clear ContractError instead
 * of crashing a screen or rendering something invented.
 *
 * FLOW: raw JSON from the server or a database row -> parse...() here ->
 * a typed, checked object -> analysis.ts and records.ts -> the screens.
 * The same names are used by the server (analysis_server/results.py), so the
 * two sides stay in step.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

export const STORAGE_BUCKET = 'wrist-xrays';

/**
 * Fracture findings below this confidence are labelled "Lower confidence,
 * review carefully". A UI review prompt, not a validated clinical cut-off.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.65;

/**
 * How often a fracture finding in each band was real, measured on the test set
 * (1,938 X-rays, model_evaluation/yolo_confidence_thresholds/analyze_scores.py).
 * `findings` = X-rays in that band; `real` = share of them with a real fracture.
 * These describe the group of X-rays in the band, not the chance for one scan.
 */
export const BAND_EVIDENCE = {
  fracture_detected: { findings: 1122, real: 0.979 }, // 65% or above
  low_confidence: { findings: 112, real: 0.652 }, // 25% to 65%
} as const;

/** Box edges this far past the image border are rounding noise and clamped. */
export const BOX_TOLERANCE = 0.02;
/** Bone age outside this range (months) is treated as unavailable. */
export const BONE_AGE_RANGE = { min: 0, max: 300 };

export const DEFAULT_CLINICAL_DISCLAIMER =
  'AI-assisted finding. Decision support only, not a diagnosis.';

// ─── Shared types ────────────────────────────────────────────────────────────

export type PatientSex = 'M' | 'F';
export type FractureType = 'Growth-Plate' | 'Shaft';
/** `scans.status` values. The server owns `analyzing` and `completed`. */
export type ScanStatus = 'uploaded' | 'analyzing' | 'completed' | 'failed';
/**
 * Which AI models a scan runs: fracture detection (YOLOv8, Module B), bone age
 * (EfficientNet, Module C), or both.
 */
export type AnalysisMode = 'fracture' | 'bone_age' | 'both';
export const ANALYSIS_MODES: readonly AnalysisMode[] = ['fracture', 'bone_age', 'both'];
export const DEFAULT_ANALYSIS_MODE: AnalysisMode = 'both';

// Does this mode run the model? Used by the result screen, history rows and the parsers below.
export function runsFracture(mode: AnalysisMode): boolean {
  return mode !== 'bone_age';
}

export function runsBoneAge(mode: AnalysisMode): boolean {
  return mode !== 'fracture';
}

/** User-facing names, shared by the scan form, results and history. */
export const ANALYSIS_MODE_INFO: Record<AnalysisMode, { title: string; model: string; description: string }> = {
  fracture: {
    title: 'Fracture detection',
    model: 'YOLOv8',
    description: 'Finds and boxes possible fractures.',
  },
  bone_age: {
    title: 'Bone age',
    model: 'EfficientNet-B3',
    description: 'Estimates skeletal age from the X-ray, sex and age.',
  },
  both: {
    title: 'Fracture + bone age',
    model: 'YOLOv8 + EfficientNet-B3',
    description: 'Runs both models on the same X-ray.',
  },
};

/** Rows saved before modes existed ran both models.
 * Any stored value -> a valid mode. Used by the parsers here, analysis.ts and records.ts. */
export function toAnalysisMode(value: unknown): AnalysisMode {
  return ANALYSIS_MODES.includes(value as AnalysisMode) ? (value as AnalysisMode) : DEFAULT_ANALYSIS_MODE;
}

/** Display classification derived from a completed result. */
export type FindingStatus = 'fracture_detected' | 'no_fracture' | 'low_confidence';

/** [x1, y1, x2, y2] as 0–1 fractions of image width / height. */
export type BoxNormalized = [number, number, number, number];

/** One fracture box with its confidence. Drawn on the X-ray by ui_components/XrayView.tsx. */
export interface Detection {
  label: string;
  confidence: number;
  box_normalized: BoxNormalized;
}

/** Body of POST /analyze. Built by analysis.ts runAnalysisPipeline(), received by analysis_server/main.py. */
export interface AnalyzeRequest {
  scan_id: string;
  image_path: string;
  patient_age_months: number;
  patient_sex: PatientSex;
  analysis_mode: AnalysisMode;
}

/** Checked result of one analysis. Produced by parseAnalyzeResponse(); returned to the scan form by analysis.ts. */
export interface AnalyzeResponse {
  scan_id: string;
  status: 'completed';
  analysis_mode: AnalysisMode;
  /** null when fracture detection was not run (bone age only). */
  fracture_detected: boolean | null;
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
  analysis_mode: AnalysisMode;
  /** null when fracture detection was not run (bone age only). */
  fracture_detected: boolean | null;
  fracture_type: FractureType | null;
  confidence: number | null;
  detections: Detection[];
  bone_age_months: number | null;
  grad_cam_path: string | null;
  clinical_disclaimer: string | null;
  created_at: string | null;
}

// ─── Validation primitives ───────────────────────────────────────────────────

/** Thrown by every parser when data has the wrong shape. Caught by analysis.ts and records.ts,
 * which show a safe message instead of wrong data. */
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

// The small checkers below each read one field and either return a safe value or throw
// ContractError. Their results go to the parse...() functions further down.
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

/**
 * A boolean, or null when the model that produces it was not run. A missing
 * value is only accepted for that model's "not run" case.
 */
function fractureFinding(obj: Json, path: string, mode: AnalysisMode): boolean | null {
  const v = obj.fracture_detected;
  if (typeof v === 'boolean') return runsFracture(mode) ? v : null;
  if ((v === null || v === undefined) && !runsFracture(mode)) return null;
  throw new ContractError(path + 'fracture_detected', 'must be a boolean');
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

/** Bone age outside a plausible range is shown as "not available", never fatal. */
function boneAgeOrNull(obj: Json, path: string): number | null {
  const v = obj.bone_age_months;
  if (v === null || v === undefined) return null;
  const n = toFiniteNumber(v);
  if (n === null) throw new ContractError(path + 'bone_age_months', 'must be a number or null');
  return n >= BONE_AGE_RANGE.min && n <= BONE_AGE_RANGE.max ? n : null;
}

function parseFractureType(obj: Json, path: string): FractureType | null {
  const v = obj.fracture_type;
  if (v === null || v === undefined) return null;
  if (v === 'Growth-Plate' || v === 'Shaft') return v;
  throw new ContractError(path + 'fracture_type', 'must be "Growth-Plate", "Shaft" or null');
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

/** Checks one fracture box. Result goes to: parseDetections(). */
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
  // Clamp rounding noise at the image border; anything further out is invalid.
  const nums = box.map(toFiniteNumber).map((n) =>
    n === null ? null : n < 0 && n >= -BOX_TOLERANCE ? 0 : n > 1 && n <= 1 + BOX_TOLERANCE ? 1 : n
  );
  if (nums.some((n) => n === null || n < 0 || n > 1)) {
    throw new ContractError(`${field}.box_normalized`, 'values must be numbers between 0 and 1');
  }
  const [x1, y1, x2, y2] = nums as number[];
  if (x2 <= x1 || y2 <= y1) {
    throw new ContractError(`${field}.box_normalized`, 'must satisfy x1 < x2 and y1 < y2');
  }

  return { label, confidence, box_normalized: [x1, y1, x2, y2] };
}

/** Accepts an array, or a JSON string of one (jsonb can arrive serialised).
 * Result goes to: parseAnalyzeResponse() and parseAnalysisResultRow(). */
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
  const out: Detection[] = [];
  raw.forEach((d, i) => {
    try {
      out.push(parseDetection(d, `${field}[${i}]`));
    } catch (err) {
      // A single unusable box must not hide the rest of the result.
      if (!(err instanceof ContractError)) throw err;
    }
  });
  return out;
}

/**
 * Validates a `POST /analyze` success body.
 * @param expectedScanId when given, the response must refer to this scan.
 * Result goes to: analysis.ts interpretResponse() -> the scan form.
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

  const analysis_mode = toAnalysisMode(obj.analysis_mode);
  return {
    scan_id,
    status: 'completed',
    analysis_mode,
    fracture_detected: fractureFinding(obj, '', analysis_mode),
    fracture_type: parseFractureType(obj, ''),
    confidence: nullableNumber(obj, 'confidence', '', { min: 0, max: 1 }),
    detections: parseDetections(obj.detections ?? []),
    bone_age_months: boneAgeOrNull(obj, ''),
    bone_age_formatted: nullableString(obj, 'bone_age_formatted', ''),
    chronological_age_formatted: requireString(obj, 'chronological_age_formatted', ''),
    grad_cam_path: nullableString(obj, 'grad_cam_path', ''),
    clinical_disclaimer: requireString(obj, 'clinical_disclaimer', ''),
  };
}

/** Validates one row of the `analysis_results` table.
 * Result goes to: analysis.ts resultFromRow() and records.ts (history and saved results). */
export function parseAnalysisResultRow(row: unknown): AnalysisResultRow {
  const obj = asObject(row, 'analysis_results');
  const p = 'analysis_results.';
  // The table has both the newer columns (confidence, grad_cam_path) and the
  // original ones (fracture_confidence, gradcam_path): use whichever is set.
  const rawConfidence = obj.confidence ?? obj.fracture_confidence;
  const rawGradCam = obj.grad_cam_path ?? obj.gradcam_path;

  const analysis_mode = toAnalysisMode(obj.analysis_mode);
  return {
    scan_id: requireString(obj, 'scan_id', p),
    analysis_mode,
    fracture_detected: fractureFinding(obj, p, analysis_mode),
    fracture_type: parseFractureType(obj, p),
    confidence: nullableNumber({ confidence: rawConfidence }, 'confidence', p, { min: 0, max: 1 }),
    detections: parseDetections(obj.detections, `${p}detections`),
    bone_age_months: boneAgeOrNull(obj, p),
    grad_cam_path: nullableString({ grad_cam_path: rawGradCam }, 'grad_cam_path', p),
    clinical_disclaimer: nullableString(obj, 'clinical_disclaimer', p),
    created_at: nullableString(obj, 'created_at', p),
  };
}

// ─── Derived helpers ─────────────────────────────────────────────────────────

/** Result -> one of three display states (fracture / no fracture / lower confidence).
 * Result goes to: the finding badge in ui_components/ui.tsx, which picks the colour and text. */
export function deriveFindingStatus(
  fractureDetected: boolean,
  confidence: number | null
): FindingStatus {
  if (!fractureDetected) return 'no_fracture';
  return confidence != null && confidence < LOW_CONFIDENCE_THRESHOLD
    ? 'low_confidence'
    : 'fracture_detected';
}

/** The evidence sentence for a fracture finding, e.g. "98 out of 100 ... were real fractures".
 * Returns null when there is no finding or no confidence to place it in a band.
 * Result goes to: the result screen (app/(app)/scan/[id].tsx), under the finding chip. */
export function bandEvidence(fractureDetected: boolean | null, confidence: number | null): string | null {
  if (fractureDetected !== true || confidence == null) return null;
  const band = deriveFindingStatus(true, confidence) === 'low_confidence'
    ? BAND_EVIDENCE.low_confidence
    : BAND_EVIDENCE.fracture_detected;
  const outOf100 = Math.round(band.real * 100);
  const isLowBand = band === BAND_EVIDENCE.low_confidence;
  const falseAlarm = isLowBand ? ' About 1 in 3 is a false alarm, so review it carefully.' : '';
  const count = String(band.findings).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `In our test set, ${outOf100} out of 100 X-rays with a finding at this level were real fractures (${count} X-rays).${falseAlarm} This describes similar X-rays, not a probability for this scan.`;
}

/** 97.4 → "8y 1m". Months are floored so fractional ages never render as "1.4m".
 * Used wherever an age is shown, and by analysis.ts resultFromRow(). */
export function formatAgeMonths(totalMonths: number): string {
  const whole = Math.max(0, Math.floor(totalMonths));
  return `${Math.floor(whole / 12)}y ${whole % 12}m`;
}

/** Where a scan's X-ray lives in the bucket: <user id>/<scan id>.jpg. Used by analysis.ts
 * ensureScanRecord(); the server checks the same pattern to confirm the image is the user's own. */
export function buildImagePath(userId: string, scanId: string): string {
  return `${userId}/${scanId}.jpg`;
}
