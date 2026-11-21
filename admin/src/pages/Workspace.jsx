import { useEffect, useState } from 'react';
import Icon from '@shared/Icon.jsx';
import { ROLE_LABELS, moodByKey } from '@shared/constants.js';
import { ScheduleCalendar, TeamMoodPanel, KINDS, span, parseDay, shiftDay, weekStart } from '@shared/work/WorkWidgets.jsx';
import { api } from '../api.js';
import { useAdmin, PageHead, Spinner, Empty, Modal, Confirm, Switch, Avatar, ago, fmtDate, localDay } from '../ui.jsx';

/** Team workspace: TLs manage their own team; managers and developers can switch between all teams. */
export default function Workspace() {
  const [team, setTeam] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [tab, setTab] = useState('overview');
  const loadCtx = () => api(`/work/context${team ? `?team=${team}` : ''}`).then(setCtx).catch(() => setCtx({ team: null }));
  useEffect(() => { loadCtx(); }, [team]);
  if (!ctx) return <Spinner />;
  if (!ctx.team) return <><PageHead title="Workspace" /><Empty icon="briefcase" title="No team">{ctx.overseer ? 'Register a team leader to create a team workspace.' : 'You are not assigned to a team yet.'}</Empty></>;
  return (
    <>
      <PageHead title="Workspace" sub={`${ctx.team.name} · ${ctx.team.members} members · Work feed, schedules and team mood`}>
        {ctx.overseer && ctx.teams?.length > 0 && (
          <select className="select" style={{ width: 'auto' }} value={ctx.team.id} onChange={(e) => setTeam(Number(e.target.value))} aria-label="Team">
            {ctx.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </PageHead>
      <div className="tabs">
        {[['overview', 'Team mood'], ['schedule', 'Schedules'], ['feed', 'Work feed'], ['members', `Members${ctx.pendingRequests ? ` · ${ctx.pendingRequests} pending` : ''}`]].map(([k, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'overview' && <MoodTab ctx={ctx} />}
      {tab === 'schedule' && <ScheduleTab ctx={ctx} />}
      {tab === 'feed' && <FeedTab ctx={ctx} />}
      {tab === 'members' && <MembersTab ctx={ctx} onCtx={loadCtx} />}
    </>
  );
}

function MoodTab({ ctx }) {
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); api(`/work/mood?team=${ctx.team.id}`).then(setData); }, [ctx.team.id]);
  if (!data) return <Spinner />;
  return <div className="card"><TeamMoodPanel data={data} Avatar={Avatar} /></div>;
}

function ScheduleTab({ ctx }) {
  const [key, setKey] = useState(0);
  const [adding, setAdding] = useState(null);
  const [item, setItem] = useState(null);
  const [who, setWho] = useState('');
  const [members, setMembers] = useState([]);
  useEffect(() => { api(`/work/members?team=${ctx.team.id}`).then(setMembers); }, [ctx.team.id]);
  const load = (from, to) => api(`/work/schedules?team=${ctx.team.id}&from=${from}&to=${to}${who ? `&user=${who}` : ''}`);
  return (
    <div className="card">
      <div className="card-head"><h3>Team calendar</h3>
        <select className="select" style={{ width: 'auto' }} value={who} onChange={(e) => { setWho(e.target.value); setKey((k) => k + 1); }} aria-label="Filter by person">
          <option value="">Everyone</option>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
        </select>
      </div>
      <ScheduleCalendar load={load} reloadKey={`${key}-${ctx.team.id}`} initialView="month" onAdd={ctx.canManage ? setAdding : undefined} onItem={setItem} />
      {adding && <ScheduleModal ctx={ctx} members={members} day={adding} onClose={() => setAdding(null)} onSaved={() => setKey((k) => k + 1)} />}
      {item && (
        <Modal title={item.title || KINDS[item.kind].label} onClose={() => setItem(null)}
          footer={ctx.canManage && <button className="btn danger" onClick={async () => { await api(`/work/schedules/${item.id}`, { method: 'DELETE' }); setItem(null); setKey((k) => k + 1); }}><Icon name="trash" size={15} /> Remove</button>}>
          <p><b>{KINDS[item.kind].label}</b> · {parseDay(item.day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · {span(item)}</p>
          <p>For: {item.user ? item.user.full_name : 'Whole team'}</p>
          {item.notes && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{item.notes}</p>}
        </Modal>
      )}
    </div>
  );
}

function ScheduleModal({ ctx, members, day, onClose, onSaved }) {
  const { toast } = useAdmin();
  const presets = { shift: ['08:00', '17:00'], lunch: ['12:00', '13:00'], meeting: ['09:00', '09:30'], overtime: ['17:00', '19:00'], coaching: ['15:00', '15:30'], training: ['13:00', '16:00'], rest: ['', ''] };
  const [f, setF] = useState({ kind: 'shift', title: '', start_time: '08:00', end_time: '17:00', notes: '', day, users: [], repeat: [], weeks: 1 });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const dates = () => {
    if (!f.repeat.length) return [f.day];
    const out = [];
    const start = weekStart(f.day);
    for (let w = 0; w < Number(f.weeks); w++) f.repeat.forEach((i) => { const d = shiftDay(start, w * 7 + i); if (d >= f.day) out.push(d); });
    return out.sort();
  };
  const save = async () => {
    try {
      const r = await api('/work/schedules', { method: 'POST', body: { team: ctx.team.id, kind: f.kind, title: f.title, notes: f.notes, start_time: f.start_time, end_time: f.end_time, days: dates(), user_ids: f.users } });
      toast(`Added ${r.length} item${r.length === 1 ? '' : 's'} · team notified`, 'success');
      onSaved(); onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="Add to schedule" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={!dates().length} onClick={save}>Add</button></>}>
      <label className="label">Type</label>
      <select className="select input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, start_time: presets[e.target.value][0], end_time: presets[e.target.value][1] })}>
        {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <label className="label">Title (optional)</label><input className="input" value={f.title} onChange={set('title')} maxLength={80} />
      {f.kind !== 'rest' && <div className="grid g2" style={{ gap: 10 }}>
        <div><label className="label">Start</label><input className="input" type="time" value={f.start_time} onChange={set('start_time')} /></div>
        <div><label className="label">End</label><input className="input" type="time" value={f.end_time} onChange={set('end_time')} /></div>
      </div>}
      <label className="label">Date</label><input className="input" type="date" value={f.day} onChange={set('day')} />
      <label className="label">Repeat weekly on</label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => <button key={d} type="button" className={`btn sm ${f.repeat.includes(i) ? '' : 'ghost'}`} onClick={() => setF({ ...f, repeat: f.repeat.includes(i) ? f.repeat.filter((x) => x !== i) : [...f.repeat, i] })}>{d}</button>)}
        {f.repeat.length > 0 && <>for <select className="select" value={f.weeks} onChange={set('weeks')}>{[1, 2, 3, 4, 6, 8].map((w) => <option key={w} value={w}>{w} wk</option>)}</select> <span className="small muted">{dates().length} dates</span></>}
      </div>
      <label className="label">People (leave empty for the whole team)</label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {members.map((m) => <button key={m.id} type="button" className={`btn sm ${f.users.includes(m.id) ? '' : 'ghost'}`} onClick={() => setF({ ...f, users: f.users.includes(m.id) ? f.users.filter((x) => x !== m.id) : [...f.users, m.id] })}>{m.full_name}</button>)}
      </div>
      <label className="label">Notes</label><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} maxLength={500} />
    </Modal>
  );
}

function FeedTab({ ctx }) {
  const { toast } = useAdmin();
  const [data, setData] = useState(null);
  const [compose, setCompose] = useState(false);
  const [del, setDel] = useState(null);
  const load = () => api(`/work/feed?team=${ctx.team.id}`).then(setData);
  useEffect(() => { setData(null); load(); }, [ctx.team.id]);
  const all = data ? [...data.pinned, ...data.posts] : [];
  return (
    <div className="card">
      <div className="card-head"><h3>Work feed</h3>
        {ctx.canPost && <button className="btn sm" onClick={() => setCompose(true)}><Icon name="megaphone" size={15} /> New post</button>}
      </div>
      <p className="hint">Visible only to {ctx.team.name} (and managers). Members see it under Home → Work in the Hunch app.</p>
      {!data ? <Spinner /> : !all.length ? <Empty icon="briefcase" title="No posts yet">Post an announcement to get the team feed started.</Empty> : all.map((p) => (
        <div key={p.id} className="notif-row">
          <Avatar user={p.author} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t">{p.author.full_name} {p.kind === 'announcement' && <span className="tag amber">Announcement</span>} {!!p.pinned && <span className="tag">Pinned</span>}</div>
            <div className="b" style={{ whiteSpace: 'pre-wrap' }}>{p.text || '📷 Photo'}</div>
            <div className="m">{ago(p.created_at)} · ❤️ {p.likes} · 💬 {p.comments}{p.images.length ? ` · ${p.images.length} photo${p.images.length > 1 ? 's' : ''}` : ''}</div>
          </div>
          {ctx.canManage && <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <button className="btn ghost sm" onClick={async () => { const r = await api(`/work/posts/${p.id}/pin`, { method: 'POST' }); toast(r.pinned ? 'Pinned' : 'Unpinned'); load(); }}><Icon name="pin" size={14} /> {p.pinned ? 'Unpin' : 'Pin'}</button>
            <button className="btn ghost sm" onClick={() => setDel(p)} aria-label="Delete post"><Icon name="trash" size={14} /></button>
          </div>}
        </div>
      ))}
      {compose && <ComposeModal ctx={ctx} onClose={() => setCompose(false)} onDone={load} />}
      {del && <Confirm title="Delete this work post?" danger confirmLabel="Delete" message="It will be removed from the team's Work feed." onClose={() => setDel(null)}
        onConfirm={async () => { await api(`/posts/${del.id}`, { method: 'DELETE' }); load(); }} />}
    </div>
  );
}

function ComposeModal({ ctx, onClose, onDone }) {
  const { toast, user } = useAdmin();
  const [f, setF] = useState({ text: '', kind: 'announcement', pinned: false });
  const canAnnounce = ctx.canManage || user.role === 'sme';
  const send = async () => {
    const form = new FormData();
    form.append('team', String(ctx.team.id)); form.append('text', f.text); form.append('kind', f.kind); form.append('pinned', f.pinned ? '1' : '0');
    try { await api('/work/posts', { method: 'POST', form }); toast('Posted · team notified', 'success'); onDone(); onClose(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title={`Post to ${ctx.team.name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={!f.text.trim()} onClick={send}>Publish</button></>}>
      {canAnnounce && <><label className="label">Type</label>
        <select className="select input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="announcement">Announcement</option><option value="post">Update</option></select></>}
      <label className="label">Message</label><textarea className="input" rows={6} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} maxLength={5000} />
      {ctx.canManage && <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}><Switch on={f.pinned} onChange={(v) => setF({ ...f, pinned: v })} label="Pin" /> Pin to the top of the feed</label>}
    </Modal>
  );
}

function MembersTab({ ctx, onCtx }) {
  const { toast } = useAdmin();
  const [members, setMembers] = useState(null);
  const [reqs, setReqs] = useState([]);
  const load = () => {
    api(`/work/members?team=${ctx.team.id}`).then(setMembers);
    if (ctx.canManage) api(`/work/permissions?team=${ctx.team.id}`).then(setReqs);
  };
  useEffect(load, [ctx.team.id]);
  const decide = async (uid, decision) => { try { await api(`/work/permissions/${uid}`, { method: 'POST', body: { team: ctx.team.id, decision } }); load(); onCtx(); } catch (e) { toast(e.message, 'error'); } };
  const pending = reqs.filter((r) => r.status === 'pending');
  const today = localDay();
  return (
    <div className="grid g3">
      <div className="card span2">
        <div className="card-head"><h3>Members</h3></div>
        {!members ? <Spinner /> : <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Role</th><th>Mood today</th><th>Active (7d)</th><th>Last active</th><th>Posting</th></tr></thead>
          <tbody>{members.map((m) => (
            <tr key={m.id}>
              <td><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Avatar user={m} size={28} /> {m.full_name}</div></td>
              <td>{ROLE_LABELS[m.role]}</td>
              <td>{m.mood_today ? `${moodByKey(m.mood_today)?.emoji} ${moodByKey(m.mood_today)?.label}` : <span className="muted">-</span>}</td>
              <td>{m.active_days_7 ?? '-'}/7</td>
              <td className="muted">{m.last_active_at ? ago(m.last_active_at) : 'never'}</td>
              <td>{m.canPost ? <span className="tag green">Can post</span> : ctx.canManage && m.role === 'agent' && ctx.settings.members_can_post
                ? <button className="btn ghost sm" onClick={() => decide(m.id, 'approve')}>Allow</button> : <span className="muted">-</span>}
                {ctx.canManage && m.role === 'agent' && m.permission === 'approved' && ctx.settings.members_can_post && <button className="btn ghost sm" style={{ marginLeft: 6 }} onClick={() => decide(m.id, 'revoke')}>Revoke</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>}
        <p className="hint" style={{ marginTop: 10 }}>Attendance = days the person opened Hunch in the last 7 days ({today}).</p>
      </div>
      <div className="card">
        <h3>Posting permission</h3>
        <p className="hint">Default is TL-only posting (SMEs can post too).</p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Switch on={ctx.settings.members_can_post} disabled={!ctx.canManage} label="Allow team members to post"
            onChange={async (v) => { await api('/work/settings', { method: 'PATCH', body: { team: ctx.team.id, members_can_post: v } }); onCtx(); }} />
          <span>Allow team members to post</span>
        </div>
        <h3 style={{ marginTop: 18 }}>Requests</h3>
        {!pending.length ? <p className="muted small">No pending requests.</p> : pending.map((r) => (
          <div key={r.user_id} className="notif-row">
            <Avatar user={r.user} size={32} />
            <div style={{ flex: 1 }}><div className="t">{r.user.full_name}</div><div className="b small">{r.note || 'No message'}</div><div className="m">{fmtDate(r.created_at)}</div>
              {ctx.canManage && <div style={{ display: 'flex', gap: 6, marginTop: 6 }}><button className="btn sm" onClick={() => decide(r.user_id, 'approve')}>Approve</button><button className="btn ghost sm" onClick={() => decide(r.user_id, 'reject')}>Reject</button></div>}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
