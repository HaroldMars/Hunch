// Work feed widgets shared by the client app and the admin dashboard:
// the team schedule calendar (day / week / month) and the team mood analytics panel.
import { useEffect, useMemo, useState } from 'react';
import Icon from '../Icon.jsx';
import './work.css';

export const KINDS = {
  shift: { label: 'Shift', color: '#5b8def' },
  lunch: { label: 'Lunch', color: '#f59e0b' },
  meeting: { label: 'Meeting', color: '#a78bfa' },
  coaching: { label: 'Coaching', color: '#2ec4b6' },
  training: { label: 'Training', color: '#1baf7a' },
  overtime: { label: 'Overtime', color: '#e5484d' },
  rest: { label: 'Rest day', color: '#9ca3af' },
};

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const shiftDay = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return ymd(d); };
export const weekStart = (s) => { const d = parseDay(s); return shiftDay(s, -((d.getDay() + 6) % 7)); };
export const fmtTime = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
};
export const span = (it) => (it.kind === 'rest' ? 'All day' : `${fmtTime(it.start_time)} – ${fmtTime(it.end_time)}`);
const dayLabel = (s, opts) => parseDay(s).toLocaleDateString(undefined, opts);
const today = () => ymd(new Date());

function rangeFor(view, anchor) {
  if (view === 'day') return [anchor, anchor];
  if (view === 'week') { const a = weekStart(anchor); return [a, shiftDay(a, 6)]; }
  const d = parseDay(anchor);
  const first = ymd(new Date(d.getFullYear(), d.getMonth(), 1));
  const gridStart = weekStart(first);
  return [gridStart, shiftDay(gridStart, 41)];
}

function Item({ it, onClick, showWho }) {
  const k = KINDS[it.kind] || KINDS.shift;
  return (
    <button className="wk-item" style={{ '--k': k.color }} onClick={() => onClick?.(it)}>
      <i />
      <span className="wk-it-main"><b>{it.title || k.label}</b><small>{span(it)}{showWho ? ` · ${it.user ? it.user.full_name : 'Whole team'}` : ''}</small></span>
      {it.title && <span className="wk-kind">{k.label}</span>}
    </button>
  );
}

/**
 * load(from, to) → Promise<items>. reloadKey re-fetches.
 * onAdd(day) shows an "Add" button for leaders; onItem(item) opens details.
 */
export function ScheduleCalendar({ load, reloadKey, onAdd, onItem, showWho = true, initialView = 'week' }) {
  const [view, setView] = useState(initialView);
  const [anchor, setAnchor] = useState(today());
  const [items, setItems] = useState(null);
  const [from, to] = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  useEffect(() => { let live = true; setItems(null); load(from, to).then((r) => live && setItems(r)).catch(() => live && setItems([])); return () => { live = false; }; }, [from, to, reloadKey]);
  const byDay = useMemo(() => {
    const m = new Map();
    (items || []).forEach((it) => { if (!m.has(it.day)) m.set(it.day, []); m.get(it.day).push(it); });
    m.forEach((list) => list.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')));
    return m;
  }, [items]);
  const step = (dir) => setAnchor(view === 'day' ? shiftDay(anchor, dir) : view === 'week' ? shiftDay(anchor, 7 * dir) : (() => { const d = parseDay(anchor); return ymd(new Date(d.getFullYear(), d.getMonth() + dir, 1)); })());
  const title = view === 'month' ? dayLabel(anchor, { month: 'long', year: 'numeric' })
    : view === 'week' ? `${dayLabel(from, { month: 'short', day: 'numeric' })} – ${dayLabel(to, { month: 'short', day: 'numeric' })}`
      : dayLabel(anchor, { weekday: 'long', month: 'long', day: 'numeric' });
  const t = today();

  return (
    <div className="wk-cal">
      <div className="wk-cal-head">
        <div className="wk-seg" role="tablist">
          {['day', 'week', 'month'].map((v) => <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
        </div>
        <div className="wk-nav">
          <button onClick={() => step(-1)} aria-label="Previous"><Icon name="back" size={18} /></button>
          <button className="wk-today" onClick={() => setAnchor(t)}>Today</button>
          <button onClick={() => step(1)} aria-label="Next"><Icon name="next" size={18} /></button>
        </div>
      </div>
      <div className="wk-title">{title}{onAdd && <button className="wk-add" onClick={() => onAdd(view === 'day' ? anchor : t >= from && t <= to ? t : from)}><Icon name="plus" size={15} /> Add</button>}</div>
      {!items ? <div className="wk-loading">Loading…</div> : view === 'month' ? (
        <div className="wk-month">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="wk-dow">{d}</div>)}
          {Array.from({ length: 42 }, (_, i) => shiftDay(from, i)).map((d) => {
            const list = byDay.get(d) || [];
            const inMonth = parseDay(d).getMonth() === parseDay(anchor).getMonth();
            return (
              <button key={d} className={`wk-cell ${inMonth ? '' : 'out'} ${d === t ? 'today' : ''}`} onClick={() => { setAnchor(d); setView('day'); }} aria-label={`${dayLabel(d, { month: 'long', day: 'numeric' })}: ${list.length} items`}>
                <span className="n">{parseDay(d).getDate()}</span>
                <span className="dots">{[...new Set(list.map((x) => x.kind))].slice(0, 4).map((k) => <i key={k} style={{ background: KINDS[k]?.color }} />)}</span>
                {list.length > 0 && <span className="c">{list.length}</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="wk-days">
          {(view === 'week' ? Array.from({ length: 7 }, (_, i) => shiftDay(from, i)) : [anchor]).map((d) => {
            const list = byDay.get(d) || [];
            return (
              <div key={d} className={`wk-day ${d === t ? 'today' : ''}`}>
                {view === 'week' && <button className="wk-day-h" onClick={() => { setAnchor(d); setView('day'); }}><b>{dayLabel(d, { weekday: 'long' })}</b><span>{dayLabel(d, { month: 'short', day: 'numeric' })}</span></button>}
                {list.length ? list.map((it) => <Item key={it.id} it={it} onClick={onItem} showWho={showWho} />) : <div className="wk-none">Nothing scheduled</div>}
              </div>
            );
          })}
        </div>
      )}
      <div className="wk-legend">{Object.entries(KINDS).map(([k, v]) => <span key={k}><i style={{ background: v.color }} />{v.label}</span>)}</div>
    </div>
  );
}

const SENT = [
  { key: 'positive', label: 'Positive', cls: 's-pos' },
  { key: 'low', label: 'Low energy', cls: 's-low' },
  { key: 'negative', label: 'Negative', cls: 's-neg' },
];

/** Team mood analytics, from GET /work/mood. Avatar renders a user's picture. */
export function TeamMoodPanel({ data, Avatar }) {
  if (!data) return null;
  const top = data.week.top;
  return (
    <div className="wk-mood">
      <div className="wk-kpis">
        <div><small>Participation today</small><b>{data.today.participation}%</b><span>{data.today.participants} of {data.members} checked in</span></div>
        <div><small>Participation · 7 days</small><b>{data.week.participation}%</b><span>avg {data.week.avgDailyParticipation}% per day</span></div>
        <div><small>Most selected</small><b>{top ? `${top.emoji} ${top.label}` : '-'}</b><span>{top ? `${top.pct}% of check-ins this week` : 'No check-ins yet'}</span></div>
        <div><small>Weekly trend</small><b className="cap">{data.direction === 'improving' ? '↗' : data.direction === 'declining' ? '↘' : '→'} {data.direction}</b><span>positive moods vs last week</span></div>
      </div>

      <div className="wk-card">
        <h4>Daily team mood</h4>
        <p className="wk-hint">Each person’s latest mood today</p>
        {!data.today.distribution.length ? <p className="wk-none">No one has checked in today yet.</p> : (
          <div className="wk-bars">
            {data.today.distribution.map((m) => (
              <div key={m.mood} className="wk-bar"><span className="l">{m.emoji} {m.label}</span><span className="t"><i style={{ width: `${m.pct}%` }} /></span><b>{m.pct}%</b></div>
            ))}
          </div>
        )}
      </div>

      <div className="wk-card">
        <h4>Weekly trend</h4>
        <p className="wk-hint">Share of check-ins per day by mood group</p>
        <div className="wk-legend">{SENT.map((s) => <span key={s.key}><i className={s.cls} />{s.label}</span>)}</div>
        <div className="wk-trend">
          {data.trend.map((d) => (
            <div key={d.day} className="wk-trow" title={`${d.participants} check-ins: ${d.positive}% positive, ${d.low}% low energy, ${d.negative}% negative`}>
              <span className="l">{parseDay(d.day).toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className="stack">
                {d.participants ? SENT.map((s) => d[s.key] > 0 && <i key={s.key} className={s.cls} style={{ width: `${d[s.key]}%` }} />) : <em>no check-ins</em>}
              </span>
              <b>{d.participants ? `${d.positive}%` : ''}</b>
            </div>
          ))}
        </div>
        <p className="wk-hint" style={{ marginTop: 6 }}>Right column: positive share that day.</p>
      </div>

      <div className="wk-card">
        <h4>Burnout indicators</h4>
        <p className="wk-hint">Mostly low-energy or negative check-ins this week, or 3+ such days in a row. A prompt to check in, not a diagnosis.</p>
        {!data.burnout.length ? <p className="wk-none">No burnout signals this week 🎉</p> : data.burnout.map((b) => (
          <div key={b.user.id} className="wk-burn">
            {Avatar ? <Avatar user={b.user} size={36} /> : null}
            <span className="m"><b>{b.user.full_name}</b><small>{b.reason}</small></span>
            {b.top && <span className="e" title={b.top.label}>{b.top.emoji}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
