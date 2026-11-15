/**
 * Small coloured labels ("pills") reused by the Scans table and the scan drawer.
 * They only turn values already loaded from the server into readable badges.
 */
import type { ScanStatus } from '../api';

// Colour, icon and text for each scan status.
const STATUS: Record<ScanStatus, { cls: string; icon: string; label: string }> = {
  completed: { cls: 'pill-good', icon: '✓', label: 'Completed' },
  analyzing: { cls: 'pill-info', icon: '◔', label: 'Analyzing' },
  uploaded: { cls: 'pill-neutral', icon: '↑', label: 'Uploaded' },
  failed: { cls: 'pill-bad', icon: '✕', label: 'Failed' },
};

/** Badge for a scan's status. Used by Scans.tsx and ScanDrawer.tsx. */
export function StatusPill({ status }: { status: ScanStatus }) {
  const s = STATUS[status] ?? STATUS.uploaded;
  return (
    <span className={`pill ${s.cls}`}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}

// Fracture findings under 65% are labelled "lower confidence" (same value as the server and the app).
export const LOW_CONFIDENCE_THRESHOLD = 0.65;

/** AI-assisted finding wording only: never "diagnosis" or "confirmed". */
export function FindingPill({
  fracture,
  confidence,
  notRun = false,
}: {
  fracture: boolean | null;
  confidence: number | null;
  /** The scan did not run fracture detection (bone age only). */
  notRun?: boolean;
}) {
  if (notRun) return <span className="muted">Not run</span>;
  if (fracture == null) return <span className="muted">No result</span>;
  if (!fracture) {
    return (
      <span className="pill pill-good">
        <span aria-hidden>○</span>No fracture suggested
      </span>
    );
  }
  if (confidence != null && confidence < LOW_CONFIDENCE_THRESHOLD) {
    return (
      <span className="pill pill-warn">
        <span aria-hidden>!</span>Fracture, lower confidence
      </span>
    );
  }
  return (
    <span className="pill pill-bad">
      <span aria-hidden>▲</span>Fracture suggested
    </span>
  );
}
