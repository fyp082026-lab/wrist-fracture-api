import { useState } from 'react';

interface Point {
  date: string;
  count: number;
}

function dayLabel(iso: string, long = false) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, long ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric' });
}

/** Single-series daily bar chart with a per-bar tooltip and a table view. */
export function DailyBarChart({ data, label }: { data: Point[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((s, d) => s + d.count, 0);

  if (asTable) {
    return (
      <div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Day</th><th>{label}</th></tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date}><td>{dayLabel(d.date, true)}</td><td className="num">{d.count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="chart-foot">
          <span className="num">{total} in 14 days</span>
          <button className="linkish" onClick={() => setAsTable(false)}>Show chart</button>
        </div>
      </div>
    );
  }

  return (
    <div className="chart">
      <div className="bars" role="img" aria-label={`${label} per day over the last 14 days, ${total} in total`}>
        {data.map((d, i) => (
          <div
            key={d.date}
            className="bar-slot"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}>
            <div className="bar" style={{ height: `${(d.count / max) * 100}%` }} />
            {hover === i && (
              <div className="tooltip">
                <strong className="num">{d.count}</strong> {label.toLowerCase()} · {dayLabel(d.date, true)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="bar-axis" aria-hidden>
        {data.map((d, i) => (
          <span key={d.date}>{i % 2 === 1 || i === data.length - 1 ? dayLabel(d.date) : ''}</span>
        ))}
      </div>
      <div className="chart-foot">
        <span className="num">{total} in 14 days · peak {max === 1 && total === 0 ? 0 : max}/day</span>
        <button className="linkish" onClick={() => setAsTable(true)}>Show as table</button>
      </div>
    </div>
  );
}
