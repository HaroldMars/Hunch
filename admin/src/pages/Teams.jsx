import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { MOODS, moodByKey, ROLE_LABELS } from '@shared/constants.js';
import { api } from '../api.js';
import { useAdmin, PageHead, Spinner, Empty, Avatar, Modal, Confirm, ago, fmtDate, daysAgo, localDay, useLoad } from '../ui.jsx';
import { RangeFilters, qs } from './Statistics.jsx';

// Team Management: developers & managers create teams and assign/transfer agents.
// Team leaders and SMEs see their own team (read-only).

export const TEAM_COLORS = ['#5B8DEF', '#3DDC84', '#FF8A3D', '#A78BFA', '#2EC4B6', '#F2545B', '#FFC83D', '#7C8DB5'];

// ---------- small pieces ----------
const Dot = ({ color, size = 10 }) => <i style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: color || 'var(--primary)', flexShrink: 0 }} />;
const MoodTag = ({ k }) => (k ? <span className="tag">{moodByKey(k)?.emoji} {moodByKey(k)?.label}</span> : <span className="muted">-</span>);

/** One horizontal bar split by mood share, with a legend of the top moods. */
export function MoodMix({ mood, top = 4, legend = true }) {
  if (!mood?.total) return <div className="small muted">No mood check-ins in this period.</div>;
  return (
    <div className="tm-mix">
      <div className="tm-mix-bar" role="img" aria-label={mood.moods.map((m) => `${moodByKey(m.mood)?.label} ${m.pct}%`).join(', ')}>
        {mood.moods.map((m) => <i key={m.mood} title={`${moodByKey(m.mood)?.label}: ${m.pct}% (${m.count})`} style={{ flexGrow: m.count, background: moodByKey(m.mood)?.color }} />)}
      </div>
      {legend && (
        <div className="tm-mix-legend">
          {mood.moods.slice(0, top).map((m) => <span key={m.mood}><Dot color={moodByKey(m.mood)?.color} size={8} /> {moodByKey(m.mood)?.label} <b>{m.pct}%</b></span>)}
        </div>
      )}
    </div>
  );
}
const Wellbeing = ({ pct, total }) => (!total ? <span className="muted">-</span>
  : <span className={`tag ${pct >= 60 ? 'green' : pct >= 40 ? 'amber' : 'red'}`}>{pct}% positive</span>);

// ---------- create / edit ----------
function TeamForm({ team, onClose, onSaved }) {
  const { toast } = useAdmin();
  const opts = useLoad(() => api('/admin/teams/options'), []);
  const [f, setF] = useState({
    name: team?.name || '', tl_id: team?.tl_id || '', sme_id: team?.sme_id || '', description: team?.description || '',
    color: team?.color || TEAM_COLORS[0], status: team?.status || 'active',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const tls = (opts.data?.teamLeaders || []).filter((t) => !t.team_id || t.team_id === team?.id);
  const pickTl = (e) => {
    const tl = (opts.data?.teamLeaders || []).find((t) => String(t.id) === e.target.value);
    setF({ ...f, tl_id: e.target.value, name: f.name || (tl ? `Team ${tl.full_name.split(' ')[0]}` : '') });
  };
  const save = async () => {
    setErr(''); setBusy(true);
    try {
      const body = { ...f, tl_id: Number(f.tl_id) || null, sme_id: Number(f.sme_id) || null };
      const r = team ? await api(`/admin/teams/${team.id}`, { method: 'PATCH', body }) : await api('/admin/teams', { method: 'POST', body });
      toast(team ? 'Team updated' : `${r.team.name} created`, 'success');
      onSaved(r.team);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={team ? `Edit ${team.name}` : 'Create team'} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn" disabled={busy || opts.loading} onClick={save}>{team ? 'Save changes' : 'Create team'}</button>
    </>}>
      {opts.loading ? <Spinner /> : (
        <>
          <label className="label">Assigned team leader</label>
          <select className="select input" value={f.tl_id} onChange={pickTl}>
            <option value="">Choose a team leader…</option>
            {tls.map((t) => <option key={t.id} value={t.id}>{t.full_name} ({t.user_code})</option>)}
          </select>
          {!tls.length && <div className="small muted" style={{ marginTop: 6 }}>Every team leader already leads a team. Create a Team Leader account in Registration first.</div>}
          {team && f.tl_id && Number(f.tl_id) !== team.tl_id && <div className="small" style={{ marginTop: 6, color: 'var(--warn)' }}>The team’s members, Work feed and schedule move to the new team leader.</div>}
          <label className="label">Team name</label>
          <input className="input" value={f.name} onChange={set('name')} placeholder="e.g. Team Carla" maxLength={60} />
          <label className="label">Assigned SME</label>
          <select className="select input" value={f.sme_id} onChange={set('sme_id')}>
            <option value="">No SME yet</option>
            {(opts.data?.smes || []).map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.team_name && s.team_id !== team?.id ? ` · now in ${s.team_name}` : ''}</option>)}
          </select>
          <label className="label">Description</label>
          <textarea className="input" style={{ minHeight: 70 }} value={f.description} onChange={set('description')} maxLength={300} placeholder="What this team handles" />
          <div className="grid g2" style={{ gap: 12 }}>
            <div>
              <label className="label">Team colour</label>
              <div className="tm-swatches">
                {TEAM_COLORS.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} className={f.color === c ? 'on' : ''} style={{ background: c }} onClick={() => setF({ ...f, color: c })} />)}
              </div>
            </div>
            <div>
              <label className="label">Team status</label>
              <select className="select input" value={f.status} onChange={set('status')}>
                <option value="active">Active</option><option value="archived">Archived</option>
              </select>
            </div>
          </div>
          {err && <div className="error-text">{err}</div>}
        </>
      )}
    </Modal>
  );
}

// ---------- member profile ----------
function MemberModal({ id, onClose }) {
  const m = useLoad(() => api(`/admin/teams/member/${id}`), [id]);
  const d = m.data;
  return (
    <Modal title="Member profile" wide onClose={onClose}>
      {m.loading ? <Spinner /> : m.error ? <div className="error-text">{m.error.message}</div> : (
        <>
          <div className="tm-profile">
            <Avatar user={d.user} size={56} />
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0 }}>{d.user.full_name}</h3>
              <div className="small muted">{ROLE_LABELS[d.user.role]} · {d.user.user_code} · {d.user.email}</div>
              <div className="small" style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {d.team ? <span className="tag"><Dot color={d.team.color} size={8} /> {d.team.name}</span> : <span className="tag amber">No team</span>}
                <span className="tag">Active {ago(d.user.last_active_at)}</span>
              </div>
            </div>
          </div>
          <div className="grid g3" style={{ gap: 12, margin: '16px 0' }}>
            <div className="tm-kpi"><span>Mood check-ins</span><b>{d.mood.total}</b><small>last 30 days</small></div>
            <div className="tm-kpi"><span>Days active</span><b>{d.attendanceDays}</b><small>last 30 days</small></div>
            <div className="tm-kpi"><span>Work posts</span><b>{d.workPostCount}</b><small>in the team feed</small></div>
          </div>
          <h4 className="tm-h">Mood analytics</h4>
          <MoodMix mood={d.mood} top={6} />
          {d.recentMoods.length > 0 && (
            <div className="tm-chips">{d.recentMoods.map((x, i) => <span key={i} className="tag">{moodByKey(x.mood)?.emoji} {x.day.slice(5)}</span>)}</div>
          )}
          <div className="grid g2" style={{ gap: 16, marginTop: 18 }}>
            <div>
              <h4 className="tm-h">Upcoming schedule</h4>
              {!d.schedule.length ? <div className="small muted">Nothing scheduled in the next two weeks.</div> : d.schedule.map((s) => (
                <div key={s.id} className="tm-line"><b>{s.day.slice(5)}</b> <span>{s.title || s.kind}</span> <span className="muted">{s.start_time ? `${s.start_time}–${s.end_time || ''}` : ''}</span></div>
              ))}
            </div>
            <div>
              <h4 className="tm-h">Recent work activity</h4>
              {!d.workPosts.length ? <div className="small muted">No work posts yet.</div> : d.workPosts.map((p) => (
                <div key={p.id} className="tm-line"><span className="tag">{p.kind}</span> <span className="tm-clip">{p.text || '(attachment)'}</span></div>
              ))}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------- org chart ----------
function Person({ u, onOpen, tag }) {
  if (!u) return <div className="tm-node empty">Not assigned</div>;
  return (
    <button className="tm-node" onClick={() => onOpen(u.id)}>
      <Avatar user={u} size={34} />
      <div style={{ minWidth: 0, textAlign: 'left' }}><b>{u.full_name}</b><span>{tag || ROLE_LABELS[u.role]}{u.last_mood ? ` · ${moodByKey(u.last_mood.mood)?.emoji}` : ''}</span></div>
    </button>
  );
}
function OrgChart({ team, onOpen }) {
  const { tl, smes, agents } = team.members;
  const primary = smes.find((s) => s.id === team.sme_id);
  const otherSmes = smes.filter((s) => s.id !== team.sme_id);
  return (
    <div className="tm-org" style={{ '--team': team.color }}>
      <div className="tm-level"><Person u={tl} onOpen={onOpen} tag="Team Leader" /></div>
      <div className="tm-stem" />
      <div className="tm-level">
        {primary || !otherSmes.length ? <Person u={primary} onOpen={onOpen} tag="SME" /> : null}
        {otherSmes.map((s) => <Person key={s.id} u={s} onOpen={onOpen} tag="SME" />)}
      </div>
      <div className="tm-stem" />
      {agents.length ? (
        <div className="tm-level tm-agents">{agents.map((a) => <Person key={a.id} u={a} onOpen={onOpen} tag="Agent" />)}</div>
      ) : <div className="tm-level"><div className="tm-node empty">No agents yet</div></div>}
    </div>
  );
}

// ---------- assign / transfer ----------
function AssignPanel({ teams, onDone, preselectTeam }) {
  const { toast } = useAdmin();
  const opts = useLoad(() => api('/admin/teams/options'), []);
  const [show, setShow] = useState('unassigned');
  const [role, setRole] = useState('agent');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(new Set());
  const [target, setTarget] = useState(preselectTeam || '');
  const [busy, setBusy] = useState(false);
  const active = teams.filter((t) => t.status === 'active' && t.tl_id);
  const activeIds = new Set(active.map((t) => t.id));
  const list = useMemo(() => (opts.data?.people || []).filter((p) => (role === 'all' || p.role === role)
    && (show === 'all' || !p.team_id || !activeIds.has(p.team_id))
    && (!q || `${p.full_name} ${p.user_code}`.toLowerCase().includes(q.toLowerCase()))), [opts.data, role, show, q, teams]); // eslint-disable-line react-hooks/exhaustive-deps
  const allOn = list.length > 0 && list.every((p) => sel.has(p.id));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel(allOn ? new Set() : new Set(list.map((p) => p.id)));
  const assign = async (teamId) => {
    setBusy(true);
    try {
      const r = await api('/admin/teams/assign', { method: 'POST', body: { user_ids: [...sel], team_id: teamId || null } });
      const name = active.find((t) => t.id === Number(teamId))?.name;
      toast(r.moved ? `${r.moved} ${r.moved === 1 ? 'person' : 'people'} ${teamId ? `assigned to ${name}` : 'removed from their team'}` : 'Nothing changed', 'success');
      setSel(new Set());
      opts.reload();
      onDone?.();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <div className="filters" style={{ marginBottom: 12 }}>
        <div className="tabs" style={{ margin: 0 }}>
          <button className={show === 'unassigned' ? 'active' : ''} onClick={() => setShow('unassigned')}>Unassigned</button>
          <button className={show === 'all' ? 'active' : ''} onClick={() => setShow('all')}>Everyone</button>
        </div>
        <label className="f"><span>Role</span>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="agent">Agents</option><option value="sme">SMEs</option><option value="all">Agents & SMEs</option>
          </select></label>
        <label className="f" style={{ flex: 1, minWidth: 180 }}><span>Search</span>
          <input className="input" style={{ width: '100%' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or user ID" /></label>
      </div>
      <div className="tm-assignbar">
        <label className="tm-check"><input type="checkbox" checked={allOn} onChange={toggleAll} disabled={!list.length} /> Select all <span className="muted">({sel.size} selected)</span></label>
        <div className="spacer" style={{ flex: 1 }} />
        <select className="select input" style={{ width: 'auto', minWidth: 180 }} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Assign to team…</option>
          {active.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="btn" disabled={busy || !sel.size || !target} onClick={() => assign(target)}><Icon name="userCheck" size={16} /> Assign {sel.size || ''}</button>
        {show === 'all' && <button className="btn ghost" disabled={busy || !sel.size} onClick={() => assign(null)}>Remove from team</button>}
      </div>
      {opts.loading ? <Spinner /> : !list.length ? (
        <Empty icon="userCheck" title={show === 'unassigned' ? 'Everyone has a team' : 'No one matches'}>{show === 'unassigned' ? 'All active agents and SMEs are assigned. Switch to “Everyone” to transfer people between teams.' : 'Try a different search or role.'}</Empty>
      ) : (
        <div className="table-wrap"><table>
          <thead><tr><th style={{ width: 36 }} /><th>Person</th><th>Role</th><th>Current team</th><th>Last active</th></tr></thead>
          <tbody>{list.map((p) => (
            <tr key={p.id} className="click" onClick={() => toggle(p.id)}>
              <td><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${p.full_name}`} /></td>
              <td><div className="user-cell"><Avatar user={p} /><div><b>{p.full_name}</b><span>{p.user_code}</span></div></div></td>
              <td>{ROLE_LABELS[p.role]}</td>
              <td>{p.team_id && activeIds.has(p.team_id) ? <span className="tag"><Dot color={p.team_color} size={8} /> {p.team_name}</span> : <span className="tag amber">Unassigned</span>}</td>
              <td className="muted">{ago(p.last_active_at)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

// ---------- compare ----------
export function TeamCompare({ range }) {
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); api(`/admin/teams/compare?${qs(range)}`).then(setData).catch(() => setData({ teams: [] })); }, [range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <Spinner />;
  if (!data.teams.length) return <Empty icon="users" title="No active teams">Create a team in Team Management to compare moods.</Empty>;
  const present = MOODS.filter((m) => data.teams.some((t) => t.mood.moods.some((x) => x.mood === m.key)));
  return (
    <div className="card">
      <div className="card-head"><h3>Team mood comparison</h3><span className="small muted">{data.period.from} → {data.period.to}</span></div>
      <div className="tm-legend">{present.map((m) => <span key={m.key}><Dot color={m.color} size={8} /> {m.label}</span>)}</div>
      <div className="table-wrap"><table>
        <thead><tr><th>Team</th><th>Members</th><th>Check-ins</th><th>Wellbeing</th><th style={{ minWidth: 260 }}>Mood mix</th><th>Top moods</th></tr></thead>
        <tbody>{data.teams.map((t) => (
          <tr key={t.id}>
            <td><Link to={`/teams/${t.id}`} className="tm-teamlink"><Dot color={t.color} /> <b>{t.name}</b></Link><div className="small muted">TL {t.tl?.full_name || '-'}</div></td>
            <td>{t.counts.total}</td>
            <td>{t.mood.total}</td>
            <td><Wellbeing pct={t.mood.positive} total={t.mood.total} /></td>
            <td><MoodMix mood={t.mood} legend={false} /></td>
            <td className="small">{t.mood.moods.slice(0, 3).map((m) => `${moodByKey(m.mood)?.emoji} ${m.pct}%`).join('  ') || '-'}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}

// ---------- list page ----------
export default function Teams() {
  const { user } = useAdmin();
  const nav = useNavigate();
  const preselect = useLocation().state?.assign || '';
  const [tab, setTab] = useState(preselect ? 'assign' : 'teams');
  const [form, setForm] = useState(false);
  const [range, setRange] = useState({ from: daysAgo(29), to: localDay() });
  const list = useLoad(() => api(`/admin/teams?${qs(range)}`), [range.from, range.to]);
  const limited = ['tl', 'sme'].includes(user.role);
  const d = list.data;

  // Team leaders and SMEs go straight to their own team.
  useEffect(() => { if (limited && d?.teams?.length === 1) nav(`/teams/${d.teams[0].id}`, { replace: true }); }, [limited, d, nav]);
  if (limited) {
    return list.loading ? <Spinner /> : (
      <><PageHead title="My Team" /><Empty icon="users" title="You’re not on a team yet">A manager or developer will add you to a team. Your team appears here once they do.</Empty></>
    );
  }
  const active = (d?.teams || []).filter((t) => t.status === 'active');
  const archived = (d?.teams || []).filter((t) => t.status === 'archived');
  return (
    <>
      <PageHead title="Team Management" sub="Create teams, assign team leaders and SMEs, and place agents in their teams">
        {d?.canManage && <button className="btn" onClick={() => setForm(true)}><Icon name="plus" size={16} /> Create Team</button>}
      </PageHead>
      <div className="tabs">
        <button className={tab === 'teams' ? 'active' : ''} onClick={() => setTab('teams')}>Teams {d ? `(${active.length})` : ''}</button>
        <button className={tab === 'assign' ? 'active' : ''} onClick={() => setTab('assign')}>Assign agents {d?.unassigned ? <span className="tm-badge">{d.unassigned}</span> : null}</button>
        <button className={tab === 'compare' ? 'active' : ''} onClick={() => setTab('compare')}>Compare teams</button>
      </div>
      {list.loading && !d ? <Spinner /> : tab === 'assign' ? <AssignPanel teams={d.teams} onDone={list.reload} preselectTeam={preselect} /> : tab === 'compare' ? (
        <><RangeFilters value={range} onChange={setRange} showMood={false} /><TeamCompare range={range} /></>
      ) : !d.teams.length ? (
        <Empty icon="users" title="No teams yet">Create the first team: choose a team leader, an SME, then assign agents.</Empty>
      ) : (
        <>
          {d.unassigned > 0 && (
            <div className="tm-callout"><Icon name="userPlus" size={18} /> <span><b>{d.unassigned}</b> active {d.unassigned === 1 ? 'person has' : 'people have'} no team yet.</span>
              <button className="btn sm" onClick={() => setTab('assign')}>Assign now</button></div>
          )}
          <div className="grid g3">{active.map((t) => <TeamCard key={t.id} t={t} />)}</div>
          {archived.length > 0 && (
            <>
              <h4 className="tm-h" style={{ marginTop: 26 }}>Archived</h4>
              <div className="grid g3">{archived.map((t) => <TeamCard key={t.id} t={t} />)}</div>
            </>
          )}
        </>
      )}
      {form && <TeamForm onClose={() => setForm(false)} onSaved={(t) => { setForm(false); nav(`/teams/${t.id}`); }} />}
    </>
  );
}

function TeamCard({ t }) {
  return (
    <Link to={`/teams/${t.id}`} className={`card tm-card ${t.status === 'archived' ? 'archived' : ''}`} style={{ '--team': t.color }}>
      <div className="tm-card-head">
        <div className="tm-mark">{t.name.replace(/^team\s+/i, '').slice(0, 1).toUpperCase()}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3>{t.name}</h3>
          <div className="small muted">{t.counts.total} member{t.counts.total === 1 ? '' : 's'} · since {new Date(t.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</div>
        </div>
        {t.status === 'archived' && <span className="tag">Archived</span>}
      </div>
      <div className="tm-roles">
        <div><span>TL</span>{t.tl ? <><Avatar user={t.tl} size={22} /> {t.tl.full_name}</> : <i className="muted">Not assigned</i>}</div>
        <div><span>SME</span>{t.sme ? <><Avatar user={t.sme} size={22} /> {t.sme.full_name}</> : <i className="muted">Not assigned</i>}</div>
        <div><span>Agents</span><b>{t.counts.agents}</b></div>
      </div>
      <MoodMix mood={t.mood} top={3} />
    </Link>
  );
}

// ---------- team overview page ----------
export function TeamView() {
  const { id } = useParams();
  const { user, toast } = useAdmin();
  const nav = useNavigate();
  const [range, setRange] = useState({ from: daysAgo(29), to: localDay() });
  const res = useLoad(() => api(`/admin/teams/${id}?${qs(range)}`), [id, range.from, range.to]);
  const all = useLoad(() => (['developer', 'manager'].includes(user.role) ? api('/admin/teams') : Promise.resolve({ teams: [] })), [id]);
  const [edit, setEdit] = useState(false);
  const [member, setMember] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [moveTo, setMoveTo] = useState('');
  useEffect(() => { setSel(new Set()); }, [id]);
  if (res.loading && !res.data) return <Spinner />;
  if (res.error) return <Empty icon="users" title="Team unavailable">{res.error.message}</Empty>;
  const { team: t, canManage, canDelete } = res.data;
  const limited = ['tl', 'sme'].includes(user.role);
  const members = [...t.members.smes, ...t.members.agents];
  const others = (all.data?.teams || []).filter((x) => x.id !== t.id && x.status === 'active' && x.tl_id);
  const toggle = (uid) => setSel((s) => { const n = new Set(s); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });
  const transfer = async (teamId) => {
    try {
      const r = await api('/admin/teams/assign', { method: 'POST', body: { user_ids: [...sel], team_id: teamId || null } });
      toast(`${r.moved} moved ${teamId ? `to ${others.find((o) => o.id === Number(teamId))?.name}` : 'out of the team'}`, 'success');
      setSel(new Set()); setMoveTo(''); res.reload(); all.reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  const setStatus = async (status) => {
    try { await api(`/admin/teams/${t.id}`, { method: 'PATCH', body: { status } }); toast(status === 'archived' ? 'Team archived' : 'Team restored', 'success'); res.reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const group = (label, people) => people.length > 0 && (
    <>
      <tr className="tm-group"><td colSpan={canManage ? 6 : 5}>{label}</td></tr>
      {people.map((m) => (
        <tr key={m.id} className="click" onClick={() => setMember(m.id)}>
          {canManage && <td style={{ width: 36 }}>{m.role !== 'tl' && <input type="checkbox" checked={sel.has(m.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(m.id)} aria-label={`Select ${m.full_name}`} />}</td>}
          <td><div className="user-cell"><Avatar user={m} /><div><b>{m.full_name}</b><span>{m.user_code} · {m.email}</span></div></div></td>
          <td>{m.job_title || ROLE_LABELS[m.role]}</td>
          <td>{m.last_mood ? <><MoodTag k={m.last_mood.mood} /> <span className="small muted">{m.last_mood.day.slice(5)}</span></> : <span className="muted">-</span>}</td>
          <td className="muted">{ago(m.last_active_at)}</td>
          <td><Icon name="next" size={16} /></td>
        </tr>
      ))}
    </>
  );
  return (
    <>
      {!limited && <div className="small" style={{ marginBottom: 10 }}><Link to="/teams"><Icon name="back" size={14} style={{ verticalAlign: -2 }} /> All teams</Link></div>}
      <PageHead title={limited ? `My Team · ${t.name}` : t.name} sub={t.description || `Led by ${t.tl?.full_name || 'no team leader yet'}`}>
        {canManage && (
          <>
            {t.status === 'active'
              ? <button className="btn ghost" onClick={() => setConfirm('archive')}><Icon name="layers" size={16} /> Archive</button>
              : <button className="btn ghost" onClick={() => setStatus('active')}><Icon name="refresh" size={16} /> Restore</button>}
            {canDelete && <button className="btn ghost" onClick={() => setConfirm('delete')}><Icon name="trash" size={16} /> Delete</button>}
            <button className="btn" onClick={() => setEdit(true)}><Icon name="edit" size={16} /> Edit team</button>
          </>
        )}
      </PageHead>
      {t.status === 'archived' && <div className="tm-callout"><Icon name="layers" size={18} /> This team is archived. Restore it to assign people again.</div>}

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card tm-info" style={{ '--team': t.color }}><span>Team</span><b><Dot color={t.color} /> {t.name}</b><small>Created {fmtDate(t.created_at)}</small></div>
        <div className="card tm-info"><span>Team leader</span><b>{t.tl?.full_name || '—'}</b><small>{t.tl?.user_code || 'Not assigned'}</small></div>
        <div className="card tm-info"><span>SME</span><b>{t.sme?.full_name || '—'}</b><small>{t.sme?.user_code || 'Not assigned'}</small></div>
        <div className="card tm-info"><span>Total members</span><b>{t.counts.total}</b><small>{t.counts.smes} SME · {t.counts.agents} agents</small></div>
      </div>

      <div className="grid g2" style={{ marginBottom: 16, alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h3>Organization chart</h3><span className="small muted">Click anyone for their profile</span></div>
          <OrgChart team={t} onOpen={setMember} />
        </div>
        <div className="card">
          <div className="card-head"><h3>Team mood analytics</h3></div>
          <RangeFilters value={range} onChange={setRange} showMood={false} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
            <Wellbeing pct={t.mood.positive} total={t.mood.total} /><span className="small muted">{t.mood.total} check-ins</span>
          </div>
          {!t.mood.total ? <div className="small muted">No mood check-ins in this period.</div> : (
            <div className="mood-legend">{t.mood.moods.map((m) => (
              <div className="row" key={m.mood}><span>{moodByKey(m.mood)?.emoji}</span><span>{moodByKey(m.mood)?.label}</span>
                <div className="bar"><i style={{ width: `${m.pct}%`, background: moodByKey(m.mood)?.color }} /></div><b>{m.pct}%</b></div>
            ))}</div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Team members</h3>
          {canManage && sel.size > 0 && (
            <div className="tm-assignbar" style={{ margin: 0, padding: 0, border: 0 }}>
              <span className="small muted">{sel.size} selected · Transfer to</span>
              <select className="select input" style={{ width: 'auto', minWidth: 160 }} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                <option value="">Choose team…</option>{others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <button className="btn sm" disabled={!moveTo} onClick={() => transfer(moveTo)}>Transfer</button>
              <button className="btn sm ghost" onClick={() => transfer(null)}>Unassign</button>
            </div>
          )}
        </div>
        {!members.length && !t.members.tl ? <Empty icon="users" title="No members yet">Assign agents from Team Management → Assign agents.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr>{canManage && <th />}<th>Name</th><th>Position</th><th>Latest mood</th><th>Last active</th><th /></tr></thead>
            <tbody>
              {group('Team leader', t.members.tl ? [t.members.tl] : [])}
              {group('SME', t.members.smes)}
              {group('Agents', t.members.agents)}
            </tbody>
          </table></div>
        )}
        {canManage && t.status === 'active' && (
          <div style={{ marginTop: 14 }}><button className="btn ghost sm" onClick={() => nav('/teams', { state: { assign: t.id } })}><Icon name="userPlus" size={15} /> Assign more agents</button></div>
        )}
      </div>

      {edit && <TeamForm team={t} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); res.reload(); }} />}
      {member && <MemberModal id={member} onClose={() => setMember(null)} />}
      {confirm === 'archive' && <Confirm title={`Archive ${t.name}?`} confirmLabel="Archive team" onClose={() => setConfirm(null)}
        message="Archived teams are hidden from the Work tab, registration and assignment. Move the team's agents and SMEs to another team first." onConfirm={() => setStatus('archived')} />}
      {confirm === 'delete' && <Confirm danger title={`Delete ${t.name}?`} confirmLabel="Delete team" onClose={() => setConfirm(null)}
        message="This removes the team. Its team leader stays a Team Leader without a team. Move its agents and SMEs to another team first."
        onConfirm={async () => { try { await api(`/admin/teams/${t.id}`, { method: 'DELETE' }); toast('Team deleted', 'success'); nav('/teams'); } catch (e) { toast(e.message, 'error'); } }} />}
    </>
  );
}
