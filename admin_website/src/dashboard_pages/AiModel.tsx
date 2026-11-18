/**
 * AI model page — one page per model (fracture detection, bone age).
 *
 * FLOW: training facts come from models.ts (fixed text and numbers); live numbers
 * come from api.modelStats() (GET /admin/api/models/{model}/stats) and are passed
 * to <FractureLive /> or <BoneAgeLive />; the model's scans are listed by <Scans />.
 */
import { useEffect, useState } from 'react';
import { api, type BoneAgeStats, type FractureStats, type ModelStats } from '../api';
import { MODELS, type ModelCard, type ModelId } from '../models';
import { Scans, type ScanFilter } from './Scans';

/** One AI model on its own: training accuracy, live numbers, review notes and its scans. */
export function AiModel({ id, tick }: { id: ModelId; tick: number }) {
  const card = MODELS[id];
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ScanFilter>({ model: id });

  // Switching to another model: reset the scan filter and clear the old numbers.
  useEffect(() => {
    setFilter({ model: id });
    setStats(null);
    setError(null);
  }, [id]);

  // Load the live numbers. Reloads on Refresh (`tick`).
  useEffect(() => {
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

      <section className="card">
        <h2>{card.metricsTitle}</h2>
        <div className="grid-tiles">
          {card.metrics.map((m) => <Tile key={m.label} {...m} />)}
        </div>
        <h3 className="drawer-section">{card.breakdownTitle}</h3>
        <ul className="rules model-breakdown">
          {card.breakdown.map((b) => (
            <li key={b.label}>
              <span>{b.label}</span>
              <span><strong className="num">{b.value}</strong>{b.note ? <span className="muted"> · {b.note}</span> : null}</span>
            </li>
          ))}
        </ul>
      </section>

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

      {filter.model && <Scans tick={tick} filter={filter} onFilter={(f) => setFilter({ ...f, model: id })} />}
    </div>
  );
}

/** Top card: what the model is, its training data and how it was trained. Data from models.ts. */
function Overview({ card }: { card: ModelCard }) {
  return (
    <section className="card">
      <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>{card.architecture}</h2>
        <div className="toolbar">
          <span className="pill pill-neutral">{card.module}</span>
          <span className="pill pill-good"><span aria-hidden>●</span>In use</span>
        </div>
      </div>
      <p className="model-purpose">{card.purpose}</p>
      <dl className="kv">
        <dt>Training data</dt><dd>{card.dataset}</dd>
        <dt>How it was trained</dt>
        <dd>
          <ul className="plain-list">
            {card.training.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </dd>
      </dl>
    </section>
  );
}

/** One number box. Used for the training accuracy and the live counts. */
function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="metric">
      <div className="tile-label">{label}</div>
      <div className="tile-value num">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

// "NN% of results" text under a tile (nothing when there are no results yet).
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}% of results` : undefined);

/** Live fracture counts from the server. */
function FractureLive({ s }: { s: FractureStats }) {
  const done = s.fracture_suggested + s.no_fracture;
  const cut = Math.round(s.low_confidence_threshold * 100);
  return (
    <div className="grid-tiles">
      <Tile label="Scans run" value={s.scans} sub={`${s.completed} completed · ${s.failed} failed · ${s.in_progress} in progress`} />
      <Tile label="Fracture suggested" value={s.fracture_suggested} sub={pct(s.fracture_suggested, done)} />
      <Tile label="No fracture suggested" value={s.no_fracture} sub={pct(s.no_fracture, done)} />
      <Tile label={`Below ${cut}% (review)`} value={s.lower_confidence} sub={pct(s.lower_confidence, s.fracture_suggested)?.replace('results', 'findings')} />
      <Tile label="Average confidence" value={s.mean_confidence != null ? `${Math.round(s.mean_confidence * 100)}%` : 'n/a'} sub="of fracture findings" />
    </div>
  );
}

/** Live bone age counts from the server. */
function BoneAgeLive({ s }: { s: BoneAgeStats }) {
  return (
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
  );
}
