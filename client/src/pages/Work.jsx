import { useEffect, useRef, useState } from 'react';
import Icon from '@shared/Icon.jsx';
import { ROLE_LABELS, moodByKey } from '@shared/constants.js';
import { ScheduleCalendar, TeamMoodPanel, KINDS, span, ymd, shiftDay, weekStart, parseDay } from '@shared/work/WorkWidgets.jsx';
import { api, toForm } from '../api.js';
import { useApp } from '../store.jsx';
import { Avatar, Sheet, Spinner, Empty, Confirm, FilePreviews, timeAgo } from '../components/ui.jsx';
import { PostCard } from '../components/Post.jsx';

/** Home → Work: the team's private workspace (feed, schedule, team, mood). */
export default function WorkTab({ initialView }) {
  const { user } = useApp();
  const [teamId, setTeamId] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [view, setView] = useState(initialView || 'feed');
  const loadCtx = () => api(`/work/context${teamId ? `?team=${teamId}` : ''}`).then(setCtx).catch(() => setCtx({ team: null }));
  useEffect(() => { loadCtx(); }, [teamId]);
  if (!ctx) return <Spinner />;
  if (!ctx.team) {
    return <Empty icon="briefcase" title="No team workspace yet">{ctx.overseer ? 'Teams appear here once team leaders are registered.' : 'You’ll see your team’s Work feed once your manager assigns you to a team leader.'}</Empty>;
  }
  const views = [['feed', 'Feed'], ['schedule', 'Schedule'], ['team', 'Team'], ...(ctx.canSeeMood ? [['mood', 'Mood']] : [])];
  return (
    <div className="work">
      {ctx.overseer && ctx.teams?.length > 1 && (
        <div className="team-switch">
          {ctx.teams.map((t) => <button key={t.id} className={t.id === ctx.team.id ? 'on' : ''} onClick={() => setTeamId(t.id)}>{t.name}</button>)}
        </div>
      )}
      <div className="work-head">
        <Avatar user={ctx.team.leader} size={44} />
        <div className="meta">
          <div className="title">{ctx.team.name} <span className="wk-private"><Icon name="lock" size={11} /> Team only</span></div>
          <div className="sub">{ctx.team.members} members · led by {ctx.team.leader.id === user.id ? 'you' : ctx.team.leader.full_name}</div>
        </div>
      </div>
      <div className="work-views" role="tablist">
        {views.map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}{k === 'team' && ctx.pendingRequests ? <i>{ctx.pendingRequests}</i> : null}</button>)}
      </div>
      {view === 'feed' && <WorkFeed ctx={ctx} onCtx={loadCtx} />}
      {view === 'schedule' && <WorkSchedule ctx={ctx} />}
      {view === 'team' && <WorkTeam ctx={ctx} onCtx={loadCtx} />}
      {view === 'mood' && <WorkMood ctx={ctx} />}
    </div>
  );
}

function WorkFeed({ ctx, onCtx }) {
  const { user, toast } = useApp();
  const [data, setData] = useState(null);
  const [kind, setKind] = useState('all');
  const [composing, setComposing] = useState(false);
  const [asking, setAsking] = useState(false);
  const q = `team=${ctx.team.id}${kind !== 'all' ? `&kind=${kind}` : ''}`;
  const load = () => api(`/work/feed?${q}`).then(setData);
  useEffect(() => { setData(null); load(); }, [q]);
  const more = async () => {
    const r = await api(`/work/feed?${q}&before=${data.nextBefore}`);
    setData((d) => ({ ...d, posts: [...d.posts, ...r.posts], nextBefore: r.nextBefore }));
  };
  const req = ctx.myRequest;
  return (
    <>
      {ctx.canPost ? (
        <button className="composer-trigger work-compose" onClick={() => setComposing(true)}>
          <Avatar user={user} size={32} /><span style={{ flex: 1 }}>{ctx.canManage ? 'Post an update or announcement…' : 'Share something with your team…'}</span><Icon name="image" />
        </button>
      ) : (
        <div className="work-perm">
          <Icon name="lock" size={18} />
          <div className="meta">
            {!ctx.settings.members_can_post ? <><b>Leader-only posting</b><small>Only {ctx.team.leader.full_name.split(' ')[0]} and SMEs post here.</small></>
              : req?.status === 'pending' ? <><b>Request sent</b><small>Waiting for {ctx.team.leader.full_name.split(' ')[0]} to approve.</small></>
                : <><b>Want to post?</b><small>{req?.status === 'rejected' ? 'Your last request wasn’t approved. You can ask again.' : 'Ask your team leader for posting permission.'}</small></>}
          </div>
          {ctx.settings.members_can_post && req?.status !== 'pending' && <button className="btn sm" onClick={() => setAsking(true)}>Request</button>}
        </div>
      )}
      <div className="chip-row">
        {[['all', 'All'], ['announcement', '📣 Announcements'], ['post', 'Posts']].map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      {!data ? <Spinner /> : !data.pinned.length && !data.posts.length ? (
        <Empty icon="briefcase" title="Nothing posted yet">{ctx.canManage ? 'Post an announcement or update. Only your team can see it.' : 'Team updates, announcements and schedules from your leader show up here.'}</Empty>
      ) : (
        <>
          {data.pinned.map((p) => <PostCard key={`pin${p.id}`} post={p} canManage={ctx.canManage} onDeleted={load} />)}
          {data.posts.map((p) => <PostCard key={p.id} post={p} canManage={ctx.canManage} onDeleted={load} />)}
          {data.nextBefore && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn ghost sm" onClick={more}>Load more</button></div>}
        </>
      )}
      {composing && <WorkComposer ctx={ctx} onClose={() => setComposing(false)} onPosted={() => { toast('Posted to the Work feed', 'success'); load(); }} />}
      {asking && <RequestPermission onClose={() => setAsking(false)} onDone={onCtx} />}
    </>
  );
}

function WorkComposer({ ctx, onClose, onPosted }) {
  const { toast, user } = useApp();
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [kind, setKind] = useState('post');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef();
  const canAnnounce = ctx.canManage || user.role === 'sme';
  const submit = async () => {
    setBusy(true);
    try {
      const f = toForm({ text, kind, team: String(ctx.team.id), pinned: pinned ? '1' : '0' });
      files.forEach((x) => f.append('images', x));
      await api('/work/posts', { method: 'POST', form: f });
      onPosted(); onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Sheet title={`Post to ${ctx.team.name}`} onClose={onClose}
      footer={<button className="btn block" disabled={busy || (!text.trim() && !files.length)} onClick={submit}>{busy ? 'Posting…' : kind === 'announcement' ? 'Publish announcement' : 'Post'}</button>}>
      {canAnnounce && (
        <div className="seg" style={{ marginBottom: 10 }}>
          <button className={kind === 'post' ? 'active' : ''} onClick={() => setKind('post')}><Icon name="edit" size={15} /> Update</button>
          <button className={kind === 'announcement' ? 'active' : ''} onClick={() => setKind('announcement')}><Icon name="megaphone" size={15} /> Announcement</button>
        </div>
      )}
      <textarea className="input" rows={5} autoFocus placeholder={kind === 'announcement' ? 'What does the team need to know?' : 'Share an update with your team…'} value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} />
      <FilePreviews files={files} onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} />
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button className="btn ghost sm" onClick={() => ref.current.click()}><Icon name="image" size={17} /> Photos</button>
        {ctx.canManage && <label className="small" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to top</label>}
      </div>
      <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => { setFiles([...files, ...e.target.files].slice(0, 10)); e.target.value = ''; }} />
      <p className="small muted"><Icon name="lock" size={12} /> Visible only to {ctx.team.name}, plus managers.</p>
    </Sheet>
  );
}

function RequestPermission({ onClose, onDone }) {
  const { toast } = useApp();
  const [note, setNote] = useState('');
  const send = async () => {
    try { await api('/work/permission', { method: 'POST', body: { note } }); toast('Request sent to your team leader', 'success'); onDone(); onClose(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Sheet title="Request posting permission" onClose={onClose} footer={<button className="btn block" onClick={send}>Send request</button>}>
      <textarea className="input" rows={3} placeholder="Why do you want to post? (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
    </Sheet>
  );
}

function WorkSchedule({ ctx }) {
  const { user } = useApp();
  const manage = ctx.canManage;
  const [key, setKey] = useState(0);
  const [adding, setAdding] = useState(null);
  const [item, setItem] = useState(null);
  const [mineOnly, setMineOnly] = useState(!manage);
  const load = (from, to) => api(`/work/schedules?team=${ctx.team.id}&from=${from}&to=${to}${mineOnly && manage ? `&user=${user.id}` : ''}`);
  return (
    <div style={{ padding: '4px 16px 16px' }}>
      <MyWeek ctx={ctx} reloadKey={key} />
      {manage && (
        <div className="chip-row" style={{ padding: '12px 0 4px' }}>
          <button className={!mineOnly ? 'on' : ''} onClick={() => { setMineOnly(false); setKey((k) => k + 1); }}>Whole team</button>
          <button className={mineOnly ? 'on' : ''} onClick={() => { setMineOnly(true); setKey((k) => k + 1); }}>Just me</button>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <ScheduleCalendar load={load} reloadKey={`${key}-${mineOnly}`} showWho={manage} onAdd={manage ? (day) => setAdding(day) : undefined} onItem={setItem} />
      </div>
      {adding && <ScheduleForm ctx={ctx} day={adding} onClose={() => setAdding(null)} onSaved={() => setKey((k) => k + 1)} />}
      {item && <ScheduleDetail item={item} manage={manage} onClose={() => setItem(null)} onDeleted={() => { setItem(null); setKey((k) => k + 1); }} />}
    </div>
  );
}

/** "My week": shift, rest day, lunch, meetings and overtime for the current week at a glance. */
function MyWeek({ ctx, reloadKey }) {
  const { user } = useApp();
  const [list, setList] = useState(null);
  const from = weekStart(ymd(new Date()));
  useEffect(() => { api(`/work/schedules?team=${ctx.team.id}&from=${from}&to=${shiftDay(from, 6)}&user=${user.id}`).then(setList); }, [reloadKey, ctx.team.id]);
  if (!list) return null;
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(from, i));
  return (
    <div className="my-week">
      <div className="mw-title"><b>My week</b><span>{parseDay(from).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {parseDay(days[6]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div>
      {days.map((d) => {
        const items = list.filter((x) => x.day === d);
        const shift = items.find((x) => x.kind === 'shift');
        const rest = items.find((x) => x.kind === 'rest');
        const extra = items.filter((x) => x !== shift && x !== rest);
        return (
          <div key={d} className={`mw-row ${d === ymd(new Date()) ? 'today' : ''}`}>
            <span className="d">{parseDay(d).toLocaleDateString(undefined, { weekday: 'short' })}</span>
            <span className="s">{rest ? <em>Rest day</em> : shift ? span(shift) : <em className="muted">-</em>}</span>
            <span className="x">{extra.map((x) => <i key={x.id} style={{ '--k': KINDS[x.kind]?.color }} title={`${x.title || KINDS[x.kind]?.label} · ${span(x)}`}>{KINDS[x.kind]?.label} {x.start_time ? span(x).split(' – ')[0] : ''}</i>)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ScheduleForm({ ctx, day, onClose, onSaved }) {
  const { toast } = useApp();
  const [members, setMembers] = useState([]);
  useEffect(() => { api(`/work/members?team=${ctx.team.id}`).then(setMembers); }, []);
  const [f, setF] = useState({ kind: 'shift', title: '', start_time: '08:00', end_time: '17:00', notes: '', who: 'team', users: [], day, repeat: [], weeks: 1 });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const presets = { shift: ['08:00', '17:00'], lunch: ['12:00', '13:00'], meeting: ['09:00', '09:30'], overtime: ['17:00', '19:00'], coaching: ['15:00', '15:30'], training: ['13:00', '16:00'], rest: ['', ''] };
  const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dates = () => {
    if (!f.repeat.length) return [f.day];
    const out = [];
    const start = weekStart(f.day);
    for (let w = 0; w < Number(f.weeks); w++) f.repeat.forEach((i) => { const d = shiftDay(start, w * 7 + i); if (d >= f.day) out.push(d); });
    return out.sort();
  };
  const save = async () => {
    try {
      const body = { team: ctx.team.id, kind: f.kind, title: f.title, notes: f.notes, start_time: f.start_time, end_time: f.end_time, days: dates(), ...(f.who === 'people' ? { user_ids: f.users } : {}) };
      const r = await api('/work/schedules', { method: 'POST', body });
      toast(`Added ${r.length} schedule ${r.length === 1 ? 'item' : 'items'}`, 'success');
      onSaved(); onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  const n = dates().length * (f.who === 'people' ? f.users.length : 1);
  return (
    <Sheet title="Add to schedule" onClose={onClose} footer={<button className="btn block" disabled={!n} onClick={save}>Add {n > 1 ? `${n} items` : ''}</button>}>
      <label className="label" style={{ marginTop: 0 }}>Type</label>
      <div className="kind-grid">
        {Object.entries(KINDS).map(([k, v]) => (
          <button key={k} className={f.kind === k ? 'on' : ''} style={{ '--k': v.color }} onClick={() => setF({ ...f, kind: k, start_time: presets[k][0], end_time: presets[k][1] })}><i />{v.label}</button>
        ))}
      </div>
      <label className="label">Title (optional)</label>
      <input className="input" value={f.title} onChange={set('title')} maxLength={80} placeholder={f.kind === 'meeting' ? 'e.g. Weekly huddle' : f.kind === 'coaching' ? 'e.g. 1:1 coaching' : ''} />
      {f.kind !== 'rest' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}><label className="label">Start</label><input className="input" type="time" value={f.start_time} onChange={set('start_time')} /></div>
          <div style={{ flex: 1 }}><label className="label">End</label><input className="input" type="time" value={f.end_time} onChange={set('end_time')} /></div>
        </div>
      )}
      <label className="label">Date</label>
      <input className="input" type="date" value={f.day} onChange={set('day')} />
      <label className="label">Repeat on</label>
      <div className="dow-row">{dows.map((d, i) => <button key={d} className={f.repeat.includes(i) ? 'on' : ''} onClick={() => setF({ ...f, repeat: f.repeat.includes(i) ? f.repeat.filter((x) => x !== i) : [...f.repeat, i] })}>{d[0]}</button>)}</div>
      {f.repeat.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>for <select value={f.weeks} onChange={set('weeks')}>{[1, 2, 3, 4, 6, 8].map((w) => <option key={w} value={w}>{w}</option>)}</select> week(s) · {dates().length} dates</div>}
      <label className="label">Who</label>
      <div className="seg">
        <button className={f.who === 'team' ? 'active' : ''} onClick={() => setF({ ...f, who: 'team' })}><Icon name="users" size={15} /> Whole team</button>
        <button className={f.who === 'people' ? 'active' : ''} onClick={() => setF({ ...f, who: 'people' })}><Icon name="user" size={15} /> Specific people</button>
      </div>
      {f.who === 'people' && members.map((m) => (
        <div key={m.id} className={`check-row ${f.users.includes(m.id) ? 'on' : ''}`} onClick={() => setF({ ...f, users: f.users.includes(m.id) ? f.users.filter((x) => x !== m.id) : [...f.users, m.id] })}>
          <Avatar user={m} size={34} /><div style={{ flex: 1, fontWeight: 600 }}>{m.full_name} <span className="muted small">{ROLE_LABELS[m.role]}</span></div><span className="box"><Icon name="check" size={14} /></span>
        </div>
      ))}
      <label className="label">Notes</label>
      <textarea className="input" rows={2} value={f.notes} onChange={set('notes')} maxLength={500} placeholder="Room, link or agenda (optional)" />
    </Sheet>
  );
}

function ScheduleDetail({ item, manage, onClose, onDeleted }) {
  const [confirm, setConfirm] = useState(false);
  const k = KINDS[item.kind];
  return (
    <Sheet title={item.title || k.label} onClose={onClose}
      footer={manage && <button className="btn ghost block" style={{ color: 'var(--danger)' }} onClick={() => setConfirm(true)}><Icon name="trash" size={17} /> Remove</button>}>
      <div className="about-row"><Icon name="calendar" size={18} /><span>Date</span><b>{parseDay(item.day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</b></div>
      <div className="about-row"><Icon name="clock" size={18} /><span>Time</span><b>{span(item)}</b></div>
      <div className="about-row"><i style={{ width: 18, height: 18, borderRadius: 5, background: k.color, display: 'inline-block' }} /><span>Type</span><b>{k.label}</b></div>
      <div className="about-row"><Icon name="users" size={18} /><span>For</span><b>{item.user ? item.user.full_name : 'Whole team'}</b></div>
      {item.notes && <p style={{ whiteSpace: 'pre-wrap' }}>{item.notes}</p>}
      {confirm && <Confirm title="Remove this schedule item?" danger confirmLabel="Remove" message="People on it won't be notified." onClose={() => setConfirm(false)}
        onConfirm={async () => { await api(`/work/schedules/${item.id}`, { method: 'DELETE' }); onDeleted(); }} />}
    </Sheet>
  );
}

function WorkTeam({ ctx, onCtx }) {
  const { toast } = useApp();
  const [members, setMembers] = useState(null);
  const [reqs, setReqs] = useState(null);
  const load = () => {
    api(`/work/members?team=${ctx.team.id}`).then(setMembers);
    if (ctx.canManage) api(`/work/permissions?team=${ctx.team.id}`).then(setReqs);
  };
  useEffect(load, [ctx.team.id]);
  const decide = async (uid, decision) => {
    try { await api(`/work/permissions/${uid}`, { method: 'POST', body: { team: ctx.team.id, decision } }); toast(decision === 'approve' ? 'Approved' : decision === 'revoke' ? 'Posting turned off' : 'Declined'); load(); onCtx(); } catch (e) { toast(e.message, 'error'); }
  };
  const toggleOpen = async () => {
    await api('/work/settings', { method: 'PATCH', body: { team: ctx.team.id, members_can_post: !ctx.settings.members_can_post } });
    toast(ctx.settings.members_can_post ? 'Back to leader-only posting' : 'Members can now request to post');
    onCtx(); load();
  };
  const pending = (reqs || []).filter((r) => r.status === 'pending');
  return (
    <div style={{ padding: '4px 16px 16px' }}>
      {ctx.canManage && (
        <div className="settings-group">
          <div className="sg-title">Posting permission</div>
          <label className="toggle-row"><span><b>Allow team members to post</b><small>{ctx.settings.members_can_post ? 'Members can request permission; you approve each person.' : 'Default: only you and SMEs post in the Work feed.'}</small></span>
            <input type="checkbox" className="switch" checked={!!ctx.settings.members_can_post} onChange={toggleOpen} /></label>
          {pending.length > 0 && <div className="sg-title" style={{ marginTop: 12 }}>Requests · {pending.length}</div>}
          {pending.map((r) => (
            <div key={r.user_id} className="row-item">
              <Avatar user={r.user} size={40} />
              <div className="meta"><div className="title">{r.user.full_name}</div><div className="sub">{r.note || 'No message'} · {timeAgo(r.created_at)}</div></div>
              <button className="btn ghost sm" onClick={() => decide(r.user_id, 'reject')}>Reject</button>
              <button className="btn sm" onClick={() => decide(r.user_id, 'approve')}>Approve</button>
            </div>
          ))}
        </div>
      )}
      <div className="settings-group">
        <div className="sg-title">Members · {members?.length ?? '…'}</div>
        {!members ? <Spinner /> : members.map((m) => {
          const mood = moodByKey(m.mood_today);
          return (
            <div key={m.id} className="row-item">
              <Avatar user={m} size={42} />
              <div className="meta">
                <div className="title">{m.full_name}</div>
                <div className="sub">{ROLE_LABELS[m.role]}{m.canPost ? ' · can post' : ''}{m.active_days_7 !== undefined ? ` · active ${m.active_days_7}/7 days` : ''}</div>
              </div>
              {mood && <span title={`Today: ${mood.label}`} style={{ fontSize: 20 }}>{mood.emoji}</span>}
              {ctx.canManage && m.role === 'agent' && ctx.settings.members_can_post && (m.permission === 'approved'
                ? <button className="btn ghost sm" onClick={() => decide(m.id, 'revoke')}>Revoke</button>
                : <button className="btn ghost sm" onClick={() => decide(m.id, 'approve')}>Allow</button>)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkMood({ ctx }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api(`/work/mood?team=${ctx.team.id}`).then(setData).catch(setErr); }, [ctx.team.id]);
  if (err) return <Empty icon="lock" title="Not available">{err.message}</Empty>;
  if (!data) return <Spinner />;
  return <div style={{ padding: '4px 16px 16px' }}><TeamMoodPanel data={data} Avatar={Avatar} /></div>;
}
