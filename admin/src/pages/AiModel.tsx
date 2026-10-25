import { useEffect, useState } from 'react';
import { api, formatMonths, type BoneAgeStats, type FractureStats, type ModelStats } from '../api';
import { MODELS, type ModelCard, type ModelId } from '../models';
import { Scans, type ScanFilter } from './Scans';

/** One AI model on its own: training accuracy, live numbers, review notes and its scans. */
export function AiModel({ id, tick }: { id: ModelId; tick: number }) {
  const card = MODELS[id];
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ScanFilter>({});

  useEffect(() => {
    setFilter(id === 'fusion' ? {} : { model: id });
    setStats(null);
    setError(null);
  }, [id]);

  useEffect(() => {
    if (id === 'fusion') return;
    let live = true;
    api.modelStats(id).then(
      (s) => live && setStats(s),
      (e: Error) => live && setError(e.message)
    );
    return () => { live = false; };
  }, [id, tick]);

  return (
    <div className="model-page">
      <Overview card={card} />

      {card.status === 'live' ? (
        <section className="card">
          <h2>{card.metricsTitle}</h2>
          <div className="grid-tiles">
            {card.metrics.map((m) => (
              <div key={m.label} className="metric">
                <div className="tile-label">{m.label}</div>
                <div className="tile-value num">{m.value}</div>
                {m.sub && <div className="tile-sub">{m.sub}</div>}
              </div>
            ))}
          </div>
          {card.breakdown && (
            <>
              <h3 className="drawer-section">{card.breakdownTitle}</h3>
              <ul className="rules model-breakdown">
                {card.breakdown.map((b) => (
                  <li key={b.label}>
                    <span>{b.label}</span>
                    <span><strong className="num">{b.value}</strong>{b.note ? <span className="muted"> · {b.note}</span> : null}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {card.figures.length > 0 && (
            <div className="figures">
              {card.figures.map((f) => (
                <figure key={f.src}>
                  <a href={f.src} target="_blank" rel="noreferrer" title="Open full size">
                    <img src={f.src} alt={f.title} loading="lazy" />
                  </a>
                  <figcaption><strong>{f.title}.</strong> {f.caption}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {card.status === 'live' && (
        <section className="card">
          <h2>Live results in this app</h2>
          <p className="muted section-lead">
            Every scan that ran this model, including scans that ran both models. These are not accuracy figures:
            the app does not know the true answer for real patients.
          </p>
          {error && <div className="banner banner-error">{error}</div>}
          {!stats && !error && <div className="center" style={{ minHeight: 120 }}><div className="spinner" /></div>}
          {stats?.model === 'fracture' && <FractureLive s={stats} />}
          {stats?.model === 'bone_age' && <BoneAgeLive s={stats} />}
        </section>
      )}

      <div className="two-col model-notes">
        <section className="card">
          <h2>Suggestions</h2>
          <ol className="suggestions">
            {card.suggestions.map((s) => (
              <li key={s.title}>
                <strong>{s.title}</strong>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="card">
          <h2>Limitations</h2>
          <ul className="limits">
            {card.limitations.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </section>
      </div>

      {id !== 'fusion' && filter.model && <Scans tick={tick} filter={filter} onFilter={(f) => setFilter({ ...f, model: filter.model })} />}
    </div>
  );
}

function Overview({ card }: { card: ModelCard }) {
  return (
    <section className="card">
      <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>{card.architecture}</h2>
        <div className="toolbar">
          <span className="pill pill-neutral">{card.module}</span>
          {card.status === 'live'
            ? <span className="pill pill-good"><span aria-hidden>●</span>In use</span>
            : <span className="pill pill-warn"><span aria-hidden>!</span>Not trained yet</span>}
        </div>
      </div>
      <p className="model-purpose">{card.purpose}</p>
      <dl className="kv">
        <dt>Training data</dt><dd>{card.dataset}</dd>
        <dt>{card.status === 'live' ? 'How it was trained' : 'Plan'}</dt>
        <dd>
          <ul className="plain-list">
            {card.training.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </dd>
      </dl>
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="metric">
      <div className="tile-label">{label}</div>
      <div className="tile-value num">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}% of results` : undefined);

function FractureLive({ s }: { s: FractureStats }) {
  const done = s.fracture_suggested + s.no_fracture;
  const max = Math.max(1, ...s.confidence_bins);
  const cut = Math.round(s.low_confidence_threshold * 100);
  return (
    <>
      <div className="grid-tiles">
        <Tile label="Scans run" value={s.scans} sub={`${s.completed} completed · ${s.failed} failed · ${s.in_progress} in progress`} />
        <Tile label="Fracture suggested" value={s.fracture_suggested} sub={pct(s.fracture_suggested, done)} />
        <Tile label="No fracture suggested" value={s.no_fracture} sub={pct(s.no_fracture, done)} />
        <Tile label={`Below ${cut}% (review)`} value={s.lower_confidence} sub={pct(s.lower_confidence, s.fracture_suggested)?.replace('results', 'findings')} />
        <Tile label="Average confidence" value={s.mean_confidence != null ? `${Math.round(s.mean_confidence * 100)}%` : 'n/a'} sub="of fracture findings" />
      </div>
      <h3 className="drawer-section">Confidence of fracture findings</h3>
      {s.fracture_suggested === 0 ? (
        <div className="empty">No fracture findings yet.</div>
      ) : (
        <div className="chart" role="img" aria-label={`Confidence of ${s.fracture_suggested} fracture findings in 10% steps`}>
          <div className="bars" style={{ height: 140 }}>
            {s.confidence_bins.map((n, i) => (
              <div key={i} className="bar-slot" title={`${i * 10}-${i * 10 + 10}%: ${n} finding${n === 1 ? '' : 's'}`}>
                <div className="bar" style={{ height: `${(n / max) * 100}%`, background: i * 10 < cut ? 'var(--warn)' : 'var(--primary-bright)' }} />
              </div>
            ))}
          </div>
          <div className="bar-axis">{s.confidence_bins.map((_, i) => <span key={i}>{i * 10}%</span>)}</div>
          <div className="chart-foot">
            <span><span className="swatch" style={{ background: 'var(--warn)' }} /> below {cut}%: shown as "lower confidence"</span>
            <span>Model's best F1 is near 40%</span>
          </div>
        </div>
      )}
    </>
  );
}

function BoneAgeLive({ s }: { s: BoneAgeStats }) {
  return (
    <>
      <div className="grid-tiles">
        <Tile label="Scans run" value={s.scans} sub={`${s.completed} completed · ${s.failed} failed · ${s.in_progress} in progress`} />
        <Tile label="With an estimate" value={s.with_estimate} />
        <Tile
          label="Average gap to real age"
          value={s.mean_abs_gap_months != null ? `${s.mean_abs_gap_months.toFixed(1)} mo` : 'n/a'}
          sub={s.mean_gap_months != null ? `on average ${s.mean_gap_months >= 0 ? 'older' : 'younger'} by ${Math.abs(s.mean_gap_months).toFixed(1)} mo` : undefined}
        />
        <Tile label="Within 12 months of real age" value={s.within_12_months} sub={pct(s.within_12_months, s.with_estimate)?.replace('results', 'estimates')} />
      </div>
      <h3 className="drawer-section">Estimated bone age vs real age entered</h3>
      {s.points.length === 0 ? <div className="empty">No bone age estimates yet.</div> : <Scatter points={s.points} />}
      <p className="muted section-lead">
        A gap is not necessarily an error: bone age can genuinely differ from real age. Gaps of more than about 2 years
        (outside the shaded band) deserve a second look.
      </p>
    </>
  );
}

/** Real age (x) against estimated bone age (y), 0-20 years, with a ±24-month band. */
function Scatter({ points }: { points: BoneAgeStats['points'] }) {
  const W = 430, H = 300, P = 36, L = 50, MAX = 240, BAND = 24;
  const x = (m: number) => L + (Math.min(m, MAX) / MAX) * (W - L - 10);
  const y = (m: number) => H - P - (Math.min(m, MAX) / MAX) * (H - P - 10);
  const ticks = [0, 60, 120, 180, 240];
  return (
    <svg className="scatter" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${points.length} scans: estimated bone age against real age`}>
      <polygon
        points={`${x(0)},${y(BAND)} ${x(MAX - BAND)},${y(MAX)} ${x(MAX)},${y(MAX)} ${x(MAX)},${y(MAX - BAND)} ${x(BAND)},${y(0)} ${x(0)},${y(0)}`}
        fill="var(--primary-muted)"
      />
      <line x1={x(0)} y1={y(0)} x2={x(MAX)} y2={y(MAX)} stroke="var(--text-muted)" strokeDasharray="4 4" />
      {ticks.map((t) => (
        <g key={t}>
          <text x={x(t)} y={H - P + 16} textAnchor="middle">{t / 12}y</text>
          <text x={L - 8} y={y(t) + 4} textAnchor="end">{t / 12}y</text>
        </g>
      ))}
      <text x={(W + L) / 2} y={H - 2} textAnchor="middle">Real age entered</text>
      <text x={12} y={(H - P) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(H - P) / 2})`}>Bone age</text>
      {points.map((p, i) => (
        <circle key={i} cx={x(p.actual_months)} cy={y(p.bone_age_months)} r={4.5} fill="var(--primary-bright)" fillOpacity={0.8}>
          <title>{`Real age ${formatMonths(p.actual_months)}, bone age ${formatMonths(p.bone_age_months)}`}</title>
        </circle>
      ))}
    </svg>
  );
}
