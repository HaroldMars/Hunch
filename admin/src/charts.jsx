import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { MOODS } from '@shared/constants.js';
import { useAdmin } from './ui.jsx';

// Chart palette: validated categorical slots (light / dark steps), never the 10 mood hues.
const PALETTE = {
  light: { s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a', grid: '#e6e6eb', axis: '#9a9aa3' },
  dark: { s1: '#3987e5', s2: '#d95926', s3: '#199e70', grid: '#26262a', axis: '#6f6f78' },
};
export const usePalette = () => PALETTE[useAdmin().theme === 'light' ? 'light' : 'dark'];

export const SENTIMENT = [
  { key: 'positive', label: 'Positive', moods: ['happy', 'excited', 'energetic', 'chill', 'curious'], slot: 's3' },
  { key: 'low', label: 'Low energy', moods: ['tired', 'lazy', 'sleepy'], slot: 's1' },
  { key: 'negative', label: 'Negative', moods: ['sad', 'angry'], slot: 's2' },
];
export const withSentiment = (rows) => rows.map((r) => ({
  ...r, ...Object.fromEntries(SENTIMENT.map((s) => [s.key, s.moods.reduce((a, m) => a + (r[m] || 0), 0)])),
}));

const axisProps = (pal) => ({ stroke: pal.axis, tick: { fill: pal.axis, fontSize: 11 }, tickLine: false, axisLine: false });

function Tip({ active, payload, label, showMoods }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const top = showMoods ? MOODS.filter((m) => row[m.key]).sort((a, b) => row[b.key] - row[a.key]).slice(0, 4) : [];
  return (
    <div className="chart-tip">
      <b>{row.label || label}</b>
      {payload.map((p) => <div key={p.dataKey} className="r"><i style={{ background: p.color }} />{p.name}: <b>{p.value}{p.unit || ''}</b></div>)}
      {top.map((m) => <div key={m.key} className="r muted">{m.emoji} {m.label} {row[m.key]}</div>)}
    </div>
  );
}

/** Single-series bar (magnitude). */
export function TotalsBars({ data, dataKey = 'total', name = 'Mood selections', height = 240, showMoods = true }) {
  const pal = usePalette();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke={pal.grid} />
        <XAxis dataKey="label" {...axisProps(pal)} interval="preserveStartEnd" minTickGap={14} />
        <YAxis allowDecimals={false} {...axisProps(pal)} />
        <Tooltip content={<Tip showMoods={showMoods} />} cursor={{ fill: pal.grid, opacity: 0.6 }} />
        <Bar dataKey={dataKey} name={name} fill={pal.s1} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Lines sharing one axis. series: [{key, name, slot, unit}] */
export function Lines({ data, series, height = 240, unit = '' }) {
  const pal = usePalette();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={pal.grid} />
        <XAxis dataKey="label" {...axisProps(pal)} interval="preserveStartEnd" minTickGap={14} />
        <YAxis allowDecimals={false} {...axisProps(pal)} unit={unit} />
        <Tooltip content={<Tip />} cursor={{ stroke: pal.axis, strokeDasharray: '3 3' }} />
        {series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} unit={s.unit} stroke={pal[s.slot]} strokeWidth={2}
            dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--panel)' }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Mood distribution: magnitude bars in one hue, identity carried by emoji + name labels. */
export function MoodDistribution({ distribution, asTable }) {
  const pal = usePalette();
  const rows = [...distribution].sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (asTable) {
    return (
      <div className="table-wrap"><table>
        <thead><tr><th>Mood</th><th style={{ textAlign: 'right' }}>Selections</th><th style={{ textAlign: 'right' }}>Share</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.mood}><td>{r.emoji} {r.label}</td><td style={{ textAlign: 'right' }}>{r.count}</td><td style={{ textAlign: 'right' }}>{r.pct}%</td></tr>)}</tbody>
      </table></div>
    );
  }
  return (
    <div className="mood-legend">
      {rows.map((r) => (
        <div key={r.mood} className="row" title={`${r.label}: ${r.count} selections (${r.pct}%)`}>
          <span style={{ fontSize: 17 }}>{r.emoji}</span>
          <span>{r.label}</span>
          <div className="bar" style={{ height: 10 }}><i style={{ width: `${(r.count / max) * 100}%`, background: pal.s1 }} /></div>
          <b>{r.pct}%</b>
        </div>
      ))}
    </div>
  );
}
