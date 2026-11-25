import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { MOODS, moodByKey, ROLE_LABELS } from '@shared/constants.js';
import { api } from '../api.js';
import { useAdmin, PageHead, Spinner, Empty, Avatar, ago, daysAgo, localDay, useLoad } from '../ui.jsx';
import { RangeFilters, qs } from './Statistics.jsx';
import { TotalsBars, Lines, MoodDistribution } from '../charts.jsx';

const Bar = ({ pct }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="bar" style={{ flex: 1 }}><i style={{ width: `${pct || 0}%` }} /></div><span className="small" style={{ width: 34, textAlign: 'right' }}>{pct ?? 0}%</span></div>
);
const MoodTag = ({ k }) => (k ? <span className="tag">{moodByKey(k)?.emoji} {moodByKey(k)?.label}</span> : <span className="muted">-</span>);

function downloadCsv(name, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function MoodLog({ fixedTeam }) {
  const [f, setF] = useState({ from: daysAgo(29), to: localDay(), teamLeaderId: fixedTeam || '', smeId: '', agentId: '', mood: '' });
  const filters = useLoad(() => api('/admin/reports/filters'), []);
  const [rows, setRows] = useState(null);
  useEffect(() => { setRows(null); api(`/admin/reports/moods?${qs(f)}`).then(setRows); }, [f]);
  const fd = filters.data;
  const tl = Number(f.teamLeaderId) || null;
  const inTeam = (x) => !tl || x.team_leader_id === tl;
  return (
    <div className="card">
      <div className="card-head"><h3>Mood log</h3>
        <button className="btn ghost sm" disabled={!rows?.length} onClick={() => downloadCsv(`hunch-moods-${f.from}-${f.to}.csv`, rows.map((r) => ({ date: r.day, time: r.created_at, name: r.full_name, user_id: r.user_code, role: ROLE_LABELS[r.role], team_leader: r.team_leader || '', mood: r.mood, source: r.source })))}>
          <Icon name="download" size={15} /> Export CSV</button>
      </div>
      <RangeFilters value={f} onChange={setF} teams={fixedTeam ? null : fd?.teamLeaders} showMood>
        <label className="f"><span>SME</span>
          <select className="select" value={f.smeId} onChange={(e) => setF({ ...f, smeId: e.target.value, agentId: '' })}>
            <option value="">All SMEs</option>{fd?.smes.filter(inTeam).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select></label>
        <label className="f"><span>Agent</span>
          <select className="select" value={f.agentId} onChange={(e) => setF({ ...f, agentId: e.target.value, smeId: '' })}>
            <option value="">All agents</option>{fd?.agents.filter(inTeam).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select></label>
      </RangeFilters>
      {!rows ? <Spinner /> : !rows.length ? <Empty icon="report" title="No mood entries">Nothing matches these filters.</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Person</th><th>Role</th><th>Team leader</th><th>Mood</th><th>Source</th></tr></thead>
          <tbody>{rows.slice(0, 300).map((r) => (
            <tr key={r.id}><td>{r.day} <span className="muted small">{new Date(r.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></td>
              <td><b>{r.full_name}</b> <span className="muted small">{r.user_code}</span></td><td>{ROLE_LABELS[r.role]}</td><td>{r.team_leader || '-'}</td>
              <td><MoodTag k={r.mood} /></td><td className="muted">{{ checkin: 'Daily check-in', note: 'Note', story: 'Mood Story' }[r.source]}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {rows?.length > 300 && <p className="small muted">Showing 300 of {rows.length}. Export CSV for the full list.</p>}
    </div>
  );
}

/** Reports: moderation (content reports, support requests) and the platform-wide mood log. */
export default function Reports() {
  const [tab, setTab] = useState(new URLSearchParams(location.search).get('tab') || 'content');
  return (
    <>
      <PageHead title="Reports" sub="Content reports and support requests from Hunch users, plus the platform mood log" />
      <div className="tabs">
        <button className={tab === 'content' ? 'active' : ''} onClick={() => setTab('content')}>Content reports</button>
        <button className={tab === 'support' ? 'active' : ''} onClick={() => setTab('support')}>Support requests</button>
        <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>Mood log</button>
      </div>
      {tab === 'log' ? <MoodLog fixedTeam={null} /> : <ReportQueue key={tab} kind={tab} />}
    </>
  );
}

const STATUS_TAG = { open: 'amber', resolved: 'green', dismissed: '' };
function ReportQueue({ kind }) {
  const { toast } = useAdmin();
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState(null);
  const load = () => api(`/admin/content-reports?kind=${kind}&status=${status}`).then(setRows);
  useEffect(() => { setRows(null); load(); }, [status]);
  const set = async (r, next) => { await api(`/admin/content-reports/${r.id}`, { method: 'PATCH', body: { status: next } }); toast(next === 'open' ? 'Reopened' : `Marked ${next}`); load(); };
  const remove = async (r) => { await api(`/admin/content-reports/${r.id}/remove`, { method: 'POST' }); toast('Content removed and report resolved', 'success'); load(); };
  return (
    <>
      <div className="filters">
        <label className="f"><span>Status</span><select className="select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option><option value="">All</option></select></label>
      </div>
      <div className="card">
        {!rows ? <Spinner /> : !rows.length ? <Empty icon={kind === 'support' ? 'comment' : 'shield'} title={status === 'open' ? 'Nothing waiting' : 'No reports'}>{kind === 'support' ? 'Messages sent from Help & Support in the app appear here.' : 'Reports people file on posts, stories, comments, chats and accounts appear here.'}</Empty> : rows.map((r) => (
          <div key={r.id} className="notif-row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="t">{kind === 'support' ? r.subject || 'Support request' : <>{r.target?.sub || r.target_type} report</>} <span className={`tag ${STATUS_TAG[r.status] ?? ''}`}>{r.status}</span></div>
              {r.target && <div className="b small" style={{ marginTop: 2 }}>{r.target.user && <b>{r.target.user.full_name}: </b>}“{r.target.label}”</div>}
              {kind !== 'support' && !r.target && <div className="b small muted">The reported {r.target_type} no longer exists.</div>}
              <div className="b small" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{kind === 'support' ? r.reason : <><span className="muted">Reason:</span> {r.reason}</>}</div>
              <div className="m">{r.reporter ? `${r.reporter.full_name} (${r.reporter.email})` : 'Deleted account'} · {ago(r.created_at)}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {r.status === 'open' ? (
                <>
                  {r.target?.removable && <button className="btn sm danger" onClick={() => remove(r)}><Icon name="trash" size={14} /> Remove</button>}
                  <button className="btn sm" onClick={() => set(r, 'resolved')}>Resolve</button>
                  {kind !== 'support' && <button className="btn ghost sm" onClick={() => set(r, 'dismissed')}>Dismiss</button>}
                </>
              ) : <button className="btn ghost sm" onClick={() => set(r, 'open')}>Reopen</button>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function TeamReport() {
  const { id } = useParams();
  const sp = new URLSearchParams(location.search);
  const [f, setF] = useState({ from: sp.get('from') || daysAgo(29), to: sp.get('to') || localDay(), mood: '', agentId: '', smeId: '' });
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState(null);
  const [full, setFull] = useState(null);
  useEffect(() => { api(`/admin/reports/team-leaders/${id}?${qs(f)}`).then(setRep).catch((e) => setErr(e.message)); }, [id, f]);
  useEffect(() => { api(`/admin/reports/team-leaders/${id}?from=${f.from}&to=${f.to}`).then(setFull).catch(() => {}); }, [id, f.from, f.to]);
  if (err) return <Empty icon="lock" title="Unavailable">{err}</Empty>;
  if (!rep) return <Spinner />;
  const { teamLeader: tl, summary: s, analytics: a } = rep;
  const memberTable = (rows, kind) => (
    <div className="table-wrap"><table>
      <thead><tr><th>{kind}</th><th>Latest mood</th><th>Top mood</th><th>Participation</th><th>Attendance</th><th>Logins</th><th>Posts</th><th>Wellbeing</th><th>Last active</th></tr></thead>
      <tbody>{rows.map((m) => (
        <tr key={m.id}>
          <td><div className="user-cell"><Avatar user={m} /><div><b>{m.full_name}</b><span>{m.user_code}{m.status !== 'active' ? ' · deactivated' : ''}</span></div></div></td>
          <td>{m.lastMood ? <><MoodTag k={m.lastMood.mood} /> <span className="small muted">{m.lastMood.day.slice(5)}</span></> : <span className="muted">-</span>}</td>
          <td><MoodTag k={m.topMood} /></td>
          <td style={{ minWidth: 120 }}><Bar pct={m.participationPct} /></td>
          <td style={{ minWidth: 120 }}><Bar pct={m.attendancePct} /><span className="small muted">{m.attendanceDays} days</span></td>
          <td>{m.logins}</td><td>{m.posts}</td>
          <td>{m.positiveShare === null ? <span className="muted">-</span> : <span className={`tag ${m.positiveShare >= 60 ? 'green' : m.positiveShare >= 40 ? 'amber' : 'red'}`}>{m.positiveShare}%</span>}</td>
          <td className="muted">{ago(m.last_active_at)}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
  return (
    <>
      <div className="small" style={{ marginBottom: 10 }}><Link to="/reports"><Icon name="back" size={14} style={{ verticalAlign: -2 }} /> All team leaders</Link></div>
      <PageHead title={tl.team_name || `Team ${tl.full_name}`} sub={`${tl.user_code} · ${tl.email} · ${s.agents} agents · ${s.smes} SMEs`}>
        <Avatar user={tl} size={44} />
      </PageHead>
      <RangeFilters value={f} onChange={setF}>
        <label className="f"><span>SME</span>
          <select className="select" value={f.smeId} onChange={(e) => setF({ ...f, smeId: e.target.value, agentId: '' })}>
            <option value="">All</option>{(full?.smes || []).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
          </select></label>
        <label className="f"><span>Agent</span>
          <select className="select" value={f.agentId} onChange={(e) => setF({ ...f, agentId: e.target.value, smeId: '' })}>
            <option value="">All</option>{(full?.agents || []).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
          </select></label>
      </RangeFilters>

      <div className="grid g4">
        <div className="card stat"><div className="k">Avg. participation</div><div className="v">{s.avgParticipation}%</div><div className="d">Days with a mood logged</div></div>
        <div className="card stat"><div className="k">Avg. attendance</div><div className="v">{s.avgAttendance}%</div><div className="d">Days active in the app</div></div>
        <div className="card stat"><div className="k">Team wellbeing</div><div className="v">{s.wellbeing ?? '-'}{s.wellbeing !== null && '%'}</div><div className="d">Average positive mood share</div></div>
        <div className="card stat"><div className="k">Dominant mood</div><div className="v">{s.dominantMood ? `${s.dominantMood.emoji} ${s.dominantMood.label}` : '-'}</div><div className="d">{s.totalLogins} logins · {s.totalPosts} posts</div></div>
      </div>

      {s.atRisk.length > 0 && (
        <div className="card" style={{ marginTop: 16, borderColor: 'var(--danger)' }}>
          <h3><Icon name="shield" size={16} style={{ verticalAlign: -3, color: 'var(--danger)' }} /> Needs attention</h3>
          <p className="hint">Members whose positive mood share is below 40% in this range.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{s.atRisk.map((x) => <span key={x.id} className="tag red">{x.full_name} · {x.positiveShare}% positive</span>)}</div>
        </div>
      )}

      <div className="grid g3" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Mood analytics</h3>
          <p className="hint">Distribution for the current filter</p>
          {a.distribution.some((d) => d.count) ? <MoodDistribution distribution={a.distribution} /> : <p className="muted">No moods logged.</p>}
        </div>
        <div className="card span2">
          <h3>Agent mood report</h3>
          <p className="hint">Mood selections per day · hover for the breakdown</p>
          <TotalsBars data={a.daily} />
        </div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Attendance activity</h3>
        <p className="hint">Team members active in the app per day</p>
        <Lines data={a.attendance} series={[{ key: 'present', name: 'Present', slot: 's3' }, { key: 'absent', name: 'Not active', slot: 's2' }]} />
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Agents ({rep.agents.length})</h3>
        <p className="hint">Performance summary per agent</p>
        {rep.agents.length ? memberTable(rep.agents, 'Agent') : <p className="muted">No agents match.</p>}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>SMEs ({rep.smes.length})</h3>
        {rep.smes.length ? memberTable(rep.smes, 'SME') : <p className="muted">No SMEs assigned to this team.</p>}
      </div>
      <div style={{ marginTop: 16 }}><MoodLog fixedTeam={Number(id)} /></div>
    </>
  );
}

export { MOODS };
