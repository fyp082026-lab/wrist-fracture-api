import { useEffect, useState } from 'react';
import { api, formatDate, formatMonths, type ScanDetail } from '../api';
import { FindingPill, StatusPill } from './Pills';

const DEFAULT_DISCLAIMER = 'AI-assisted finding. Decision support only, not a diagnosis.';

export function ScanDrawer({ scanId, onClose }: { scanId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ScanDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setError(null);
    api.scan(scanId).then(
      (d) => live && setDetail(d),
      (e: Error) => live && setError(e.message)
    );
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      live = false;
      window.removeEventListener('keydown', onKey);
    };
  }, [scanId, onClose]);

  const r = detail?.result;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Scan details">
        <div className="drawer-head">
          <h2>Scan details</h2>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        {error && <div className="banner banner-error">{error}</div>}
        {!detail && !error && <div className="center"><div className="spinner" /></div>}
        {detail && (
          <>
            <div className="xray">
              {detail.image_url ? (
                <>
                  <img src={detail.image_url} alt="Wrist X-ray" />
                  {(r?.detections ?? []).map((d, i) => {
                    const [x1, y1, x2, y2] = d.box_normalized;
                    return (
                      <div
                        key={i}
                        className="box"
                        style={{ left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` }}>
                        <span>{d.label} {Math.round(d.confidence * 100)}%</span>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className="empty">Image not available</div>
              )}
            </div>
            <dl className="kv">
              <dt>Status</dt><dd><StatusPill status={detail.scan.status} /></dd>
              <dt>AI-assisted finding</dt><dd><FindingPill fracture={r?.fracture_detected ?? null} confidence={r?.confidence ?? null} /></dd>
              <dt>Top confidence</dt><dd className="num">{r?.confidence != null ? `${Math.round(r.confidence * 100)}%` : 'Not available'}</dd>
              <dt>Estimated bone age</dt><dd className="num">{formatMonths(r?.bone_age_months)}</dd>
              <dt>Patient code</dt><dd>{detail.patient?.patient_code || 'None'}</dd>
              <dt>Patient age</dt><dd className="num">{formatMonths(detail.patient?.age_months)}</dd>
              <dt>Sex</dt><dd>{detail.patient?.sex === 'F' ? 'Female' : detail.patient?.sex === 'M' ? 'Male' : 'Unknown'}</dd>
              <dt>Clinician</dt><dd>{detail.user_email ?? 'Unknown'}</dd>
              <dt>Created</dt><dd>{formatDate(detail.scan.created_at)}</dd>
              <dt>Scan ID</dt><dd className="num muted" style={{ wordBreak: 'break-all' }}>{detail.scan.id}</dd>
            </dl>
            <p className="disclaimer">{r?.clinical_disclaimer || DEFAULT_DISCLAIMER}</p>
          </>
        )}
      </aside>
    </>
  );
}
