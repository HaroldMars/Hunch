import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { TEAM_ROLE_LABELS, moodByKey } from '@shared/constants.js';
import { ScheduleCalendar, TeamMoodPanel, KINDS, span, ymd, shiftDay, weekStart, parseDay } from '@shared/work/WorkWidgets.jsx';
import { api, toForm } from '../api.js';
import { useApp } from '../store.jsx';
import { Avatar, Sheet, Spinner, Empty, Confirm, FilePreviews, TeamLogo, timeAgo } from '../components/ui.jsx';
import { PostCard } from '../components/Post.jsx';
import { StoryBar, StoryViewer } from '../components/Stories.jsx';

/** Home → Work (Work Mode): your private teams. Feed, schedule, members and mood for the selected team. */
export default function WorkTab({ initialView }) {
  const [teamId, setTeamId] = useState(() => Number(localStorage.getItem('hunch_work_team')) || null);
  const [ctx, setCtx] = useState(null);
  const [view, setView] = useState(initialView || 'feed');
  const [sheet, setSheet] = useState(null); // 'create' | 'join' | 'invites' | 'invite' | 'manage'
  const loadCtx = () => api(`/work/context${teamId ? `?team=${teamId}` : ''}`)
    .then((c) => { if (teamId && !c.team && c.teams?.length) return pick(c.teams[0].id); setCtx(c); })
    .catch(() => setCtx({ team: null, teams: [], invites: 0 }));
  const pick = (id) => { try { localStorage.setItem('hunch_work_team', String(id || '')); } catch { /* private mode */ } setTeamId(id); };
  useEffect(() => { loadCtx(); }, [teamId]);
  if (!ctx) return <Spinner />;
  const sheets = (
    <>
      {sheet === 'create' && <CreateTeam onClose={() => setSheet(null)} onCreated={(t) => { setSheet(null); setView('team'); pick(t.id); loadCtx(); }} />}
      {sheet === 'join' && <JoinTeam onClose={() => setSheet(null)} onJoined={(t) => { setSheet(null); pick(t.id); loadCtx(); }} />}
      {sheet === 'invites' && <MyInvites onClose={() => { setSheet(null); loadCtx(); }} onJoined={(t) => { setSheet(null); pick(t.id); loadCtx(); }} />}
      {sheet === 'invite' && ctx.team && <InviteSheet ctx={ctx} onClose={() => setSheet(null)} />}
    </>
  );
  if (!ctx.team) return <><NoTeam ctx={ctx} onSheet={setSheet} />{sheets}</>;
  const views = [['feed', 'Feed'], ['schedule', 'Schedule'], ['team', 'Team'], ...(ctx.canSeeMood ? [['mood', 'Mood']] : [])];
  return (
    <div className="work">
      <div className="team-switch" aria-label="Your teams">
        {ctx.teams.map((t) => <button key={t.id} className={t.id === ctx.team.id ? 'on' : ''} onClick={() => pick(t.id)}><TeamLogo team={t} size={20} /> {t.name}</button>)}
        {ctx.invites > 0 && <button onClick={() => setSheet('invites')}><Icon name="mail" size={15} /> Invitations <i className="ts-badge">{ctx.invites}</i></button>}
        <button onClick={() => setSheet('create')} aria-label="Create a team"><Icon name="plus" size={15} /> New team</button>
        <button onClick={() => setSheet('join')}><Icon name="key" size={15} /> Join</button>
      </div>
      <div className="work-head">
        <TeamLogo team={ctx.team} size={48} />
        <div className="meta">
          <div className="title">{ctx.team.name} <span className="wk-private"><Icon name="lock" size={11} /> Private</span></div>
          <div className="sub">{ctx.team.members} member{ctx.team.members === 1 ? '' : 's'} · you’re {ctx.role === 'owner' ? 'the owner' : `${ctx.role === 'admin' ? 'an' : 'a'} ${TEAM_ROLE_LABELS[ctx.role].toLowerCase()}`}</div>
          {ctx.team.description && <div className="sub wk-desc">{ctx.team.description}</div>}
        </div>
        {ctx.canInvite && <button className="btn sm" onClick={() => setSheet('invite')}><Icon name="userPlus" size={16} /> Invite</button>}
      </div>
      <div className="work-views" role="tablist">
        {views.map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
      </div>
      {view === 'feed' && <WorkFeed ctx={ctx} />}
      {view === 'schedule' && <WorkSchedule ctx={ctx} />}
      {view === 'team' && <WorkTeam ctx={ctx} onCtx={loadCtx} onInvite={() => setSheet('invite')} onGone={() => { pick(null); setView('feed'); }} />}
      {view === 'mood' && <WorkMood ctx={ctx} />}
      {sheets}
    </div>
  );
}

/** Work Mode is on but you're not on a team yet. */
function NoTeam({ ctx, onSheet }) {
  return (
    <div className="work-empty">
      <div className="we-art"><Icon name="briefcase" size={34} /></div>
      <h3>Start working together</h3>
      <p>Create a private team for your startup, class project, gaming squad or business. Only members can see what happens inside.</p>
      {ctx.invites > 0 && (
        <button className="we-invites" onClick={() => onSheet('invites')}>
          <Icon name="mail" size={20} /><span><b>{ctx.invites} team invitation{ctx.invites === 1 ? '' : 's'}</b><small>Review and accept or decline</small></span><Icon name="next" size={17} />
        </button>
      )}
      <div className="we-actions">
        <button className="btn block" onClick={() => onSheet('create')}><Icon name="plus" size={18} /> Create a team</button>
        <button className="btn ghost block" onClick={() => onSheet('join')}><Icon name="key" size={18} /> Join with an invite code</button>
      </div>
      <p className="small muted"><Icon name="lock" size={12} /> Teams never appear on your public profile.</p>
    </div>
  );
}

function LogoPicker({ team, file, onFile }) {
  const ref = useRef();
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className="logo-pick">
      <TeamLogo team={{ ...team, logo: preview || team?.logo }} size={64} />
      <button type="button" className="btn ghost sm" onClick={() => ref.current.click()}><Icon name="camera" size={16} /> {preview || team?.logo ? 'Change logo' : 'Add logo'}</button>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => { onFile(e.target.files[0] || null); e.target.value = ''; }} />
    </div>
  );
}

function CreateTeam({ onClose, onCreated }) {
  const { toast } = useApp();
  const [f, setF] = useState({ name: '', description: '', members_can_post: true, members_can_invite: false });
  const [logo, setLogo] = useState(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const form = toForm({ name: f.name, description: f.description, members_can_post: f.members_can_post ? '1' : '0', members_can_invite: f.members_can_invite ? '1' : '0' });
      if (logo) form.append('logo', logo);
      const t = await api('/work/teams', { method: 'POST', form });
      toast(`${t.name} is ready. Invite your team!`, 'success');
      onCreated(t);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Create team" onClose={onClose} footer={<button className="btn block" disabled={busy || !f.name.trim()} onClick={create}>{busy ? 'Creating…' : 'Create team'}</button>}>
      <LogoPicker file={logo} onFile={setLogo} team={{ name: f.name }} />
      <label className="label">Team name</label>
      <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} placeholder="e.g. Marketing Team" autoFocus />
      <label className="label">Description <span className="muted">(optional)</span></label>
      <textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} placeholder="What is this team for?" />
      <div className="sg-title" style={{ marginTop: 14 }}>Privacy settings</div>
      <div className="wk-note"><Icon name="lock" size={16} /><span><b>Private team</b><small>Only members can see the team, its feed, chats and members. It never shows on anyone’s profile.</small></span></div>
      <label className="toggle-row"><span><b>Members can post</b><small>Otherwise only the owner and admins post in the Work feed.</small></span>
        <input type="checkbox" className="switch" checked={f.members_can_post} onChange={(e) => setF({ ...f, members_can_post: e.target.checked })} /></label>
      <label className="toggle-row"><span><b>Members can invite</b><small>Otherwise only the owner and admins invite people.</small></span>
        <input type="checkbox" className="switch" checked={f.members_can_invite} onChange={(e) => setF({ ...f, members_can_invite: e.target.checked })} /></label>
    </Sheet>
  );
}

function JoinTeam({ onClose, onJoined }) {
  const { toast } = useApp();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const join = async () => {
    setBusy(true);
    try { const t = await api('/work/join', { method: 'POST', body: { code } }); toast(`You joined ${t.name}`, 'success'); onJoined(t); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Join a team" onClose={onClose} footer={<button className="btn block" disabled={busy || code.trim().length < 4} onClick={join}>{busy ? 'Joining…' : 'Join team'}</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>Ask a team owner or admin for the team’s invite code.</p>
      <input className="input code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))} placeholder="INVITE CODE" autoFocus aria-label="Invite code" />
    </Sheet>
  );
}

/** Invitations sent to you: accept or decline. */
function MyInvites({ onClose, onJoined }) {
  const { toast } = useApp();
  const [list, setList] = useState(null);
  const load = () => api('/work/invites').then(setList);
  useEffect(() => { load(); }, []);
  const answer = async (inv, decision) => {
    try {
      const r = await api(`/work/invites/${inv.id}`, { method: 'POST', body: { decision } });
      if (decision === 'accept') { toast(`You joined ${inv.team.name}`, 'success'); return onJoined(r.team); }
      toast('Invitation declined'); load();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Sheet title="Team invitations" onClose={onClose}>
      {!list ? <Spinner /> : !list.length ? <Empty icon="mail" title="No invitations">When someone invites you to a team, it shows up here.</Empty> : list.map((i) => (
        <div key={i.id} className="invite-card">
          <TeamLogo team={i.team} size={46} />
          <div className="meta">
            <b>{i.team.name}</b>
            <small>{i.invited_by?.full_name} invited you · {i.team.members} member{i.team.members === 1 ? '' : 's'} · {timeAgo(i.created_at)}</small>
            {i.team.description && <small className="desc">{i.team.description}</small>}
            <div className="ic-actions">
              <button className="btn ghost sm" onClick={() => answer(i, 'decline')}>Decline</button>
              <button className="btn sm" onClick={() => answer(i, 'accept')}>Accept</button>
            </div>
          </div>
        </div>
      ))}
    </Sheet>
  );
}

/** Invite friends, or anyone by username or email. */
function InviteSheet({ ctx, onClose }) {
  const { toast } = useApp();
  const [friends, setFriends] = useState(null);
  const [members, setMembers] = useState([]);
  const [picked, setPicked] = useState([]);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/friends').then(setFriends);
    api(`/work/members?team=${ctx.team.id}`).then((m) => setMembers(m.map((x) => x.id)));
  }, [ctx.team.id]);
  const idents = text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api(`/work/teams/${ctx.team.id}/invites`, { method: 'POST', body: { userIds: picked, identifiers: idents } });
      setResults(r.results);
      const ok = r.results.filter((x) => x.ok).length;
      if (ok) toast(`${ok} invitation${ok === 1 ? '' : 's'} sent`, 'success');
      setPicked([]); setText('');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const shown = (friends || []).filter((f) => !members.includes(f.id) && f.full_name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Sheet title={`Invite to ${ctx.team.name}`} onClose={onClose}
      footer={<button className="btn block" disabled={busy || (!picked.length && !idents.length)} onClick={send}>{busy ? 'Sending…' : `Send invitation${picked.length + idents.length > 1 ? 's' : ''}`}</button>}>
      <label className="label" style={{ marginTop: 0 }}>Username or email</label>
      <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="@username or name@email.com" autoCapitalize="off" autoCorrect="off" />
      <div className="small muted" style={{ marginTop: 4 }}>Separate several with commas. People without an account get an email invitation.</div>
      {ctx.team.invite_code && (
        <div className="code-box">
          <span><small>Or share the invite code</small><b>{ctx.team.invite_code}</b></span>
          <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(ctx.team.invite_code).then(() => toast('Code copied'))}><Icon name="link" size={15} /> Copy</button>
        </div>
      )}
      {results && (
        <div className="invite-results">
          {results.map((r, i) => <div key={i} className={r.ok ? 'ok' : 'no'}><Icon name={r.ok ? 'check' : 'close'} size={14} /> <b>{r.target}</b> {r.reason ? `· ${r.reason}` : '· invited'}</div>)}
        </div>
      )}
      <div className="sg-title" style={{ marginTop: 12 }}>Friends</div>
      {friends && friends.length > 6 && <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search friends" style={{ marginBottom: 6 }} />}
      {!friends ? <Spinner /> : !shown.length ? <div className="small muted" style={{ padding: '8px 2px' }}>{friends.length ? 'All your friends are already on this team.' : 'Add friends from Connect, or invite by username or email.'}</div> : shown.map((f) => (
        <div key={f.id} className={`check-row ${picked.includes(f.id) ? 'on' : ''}`} onClick={() => setPicked(picked.includes(f.id) ? picked.filter((x) => x !== f.id) : [...picked, f.id])}>
          <Avatar user={f} size={38} /><div style={{ flex: 1, fontWeight: 600 }}>{f.full_name}{f.username && <span className="muted small"> @{f.username}</span>}</div><span className="box"><Icon name="check" size={14} /></span>
        </div>
      ))}
    </Sheet>
  );
}

/** Team-visibility stories, shown at the top of the team's Work feed. */
function WorkStories({ teamId }) {
  const [groups, setGroups] = useState([]);
  const [viewer, setViewer] = useState(null);
  const load = () => api(`/work/stories?team=${teamId}`).then(setGroups).catch(() => setGroups([]));
  useEffect(() => { load(); }, [teamId]);
  if (!groups.length) return null;
  return (
    <div className="work-stories">
      <div className="sc-label" style={{ margin: '4px 16px 6px' }}>💼 Team stories</div>
      <StoryBar groups={groups} onOpen={setViewer} hideAdd />
      {viewer !== null && <StoryViewer groups={groups} startGroup={viewer} onClose={() => { setViewer(null); load(); }} onChanged={load} />}
    </div>
  );
}

function WorkFeed({ ctx }) {
  const { user, toast } = useApp();
  const [data, setData] = useState(null);
  const [kind, setKind] = useState('all');
  const [composing, setComposing] = useState(false);
  const q = `team=${ctx.team.id}${kind !== 'all' ? `&kind=${kind}` : ''}`;
  const load = () => api(`/work/feed?${q}`).then(setData);
  useEffect(() => { setData(null); load(); }, [q]);
  const more = async () => {
    const r = await api(`/work/feed?${q}&before=${data.nextBefore}`);
    setData((d) => ({ ...d, posts: [...d.posts, ...r.posts], nextBefore: r.nextBefore }));
  };
  return (
    <>
      <WorkStories teamId={ctx.team.id} />
      {ctx.canPost ? (
        <button className="composer-trigger work-compose" onClick={() => setComposing(true)}>
          <Avatar user={user} size={32} /><span style={{ flex: 1 }}>{ctx.canManage ? 'Post an update or announcement…' : 'Share something with your team…'}</span><Icon name="image" />
        </button>
      ) : (
        <div className="work-perm">
          <Icon name="lock" size={18} />
          <div className="meta"><b>Owner and admins post here</b><small>You can still chat with the team in Chats → Teams.</small></div>
        </div>
      )}
      <div className="chip-row">
        {[['all', 'All'], ['announcement', '📣 Announcements'], ['post', 'Posts']].map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      {!data ? <Spinner /> : !data.pinned.length && !data.posts.length ? (
        <Empty icon="briefcase" title="Nothing posted yet">{ctx.canPost ? 'Post an update or announcement. Only your team can see it.' : 'Team updates and announcements show up here.'}</Empty>
      ) : (
        <>
          {data.pinned.map((p) => <PostCard key={`pin${p.id}`} post={p} canManage={ctx.canManage} onDeleted={load} />)}
          {data.posts.map((p) => <PostCard key={p.id} post={p} canManage={ctx.canManage} onDeleted={load} />)}
          {data.nextBefore && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn ghost sm" onClick={more}>Load more</button></div>}
        </>
      )}
      {composing && <WorkComposer ctx={ctx} onClose={() => setComposing(false)} onPosted={() => { toast('Posted to the Work feed', 'success'); load(); }} />}
    </>
  );
}

function WorkComposer({ ctx, onClose, onPosted }) {
  const { toast } = useApp();
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [kind, setKind] = useState('post');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef();
  const canAnnounce = ctx.canManage;
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
      <p className="small muted"><Icon name="lock" size={12} /> Visible only to members of {ctx.team.name}.</p>
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
          <Avatar user={m} size={34} /><div style={{ flex: 1, fontWeight: 600 }}>{m.full_name} <span className="muted small">{TEAM_ROLE_LABELS[m.team_role]}</span></div><span className="box"><Icon name="check" size={14} /></span>
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

/** Team: members and roles, invitations, channels, settings, and leaving or deleting the team. */
function WorkTeam({ ctx, onCtx, onInvite, onGone }) {
  const { user, toast } = useApp();
  const nav = useNavigate();
  const [members, setMembers] = useState(null);
  const [invites, setInvites] = useState([]);
  const [channels, setChannels] = useState([]);
  const [acting, setActing] = useState(null); // member whose role menu is open
  const [sheet, setSheet] = useState(null); // 'edit' | 'channel'
  const [confirm, setConfirm] = useState(null); // 'leave' | 'delete'
  const t = ctx.team;
  const load = () => {
    api(`/work/members?team=${t.id}`).then(setMembers);
    api(`/work/teams/${t.id}/channels`).then(setChannels).catch(() => setChannels([]));
    if (ctx.canInvite) api(`/work/teams/${t.id}/invites`).then(setInvites).catch(() => setInvites([]));
  };
  useEffect(load, [t.id]);
  const setSetting = async (k, v) => {
    try { await api(`/work/teams/${t.id}`, { method: 'PATCH', body: { [k]: v ? '1' : '0' } }); onCtx(); } catch (e) { toast(e.message, 'error'); }
  };
  const setRole = async (m, role) => {
    try {
      await api(`/work/teams/${t.id}/members/${m.id}`, { method: 'PATCH', body: { role } });
      toast(role === 'owner' ? `${m.full_name.split(' ')[0]} is now the owner` : `${m.full_name.split(' ')[0]} is now ${role === 'admin' ? 'an admin' : 'a member'}`, 'success');
      setActing(null); load(); onCtx();
    } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (m) => {
    try { await api(`/work/teams/${t.id}/members/${m.id}`, { method: 'DELETE' }); toast(`Removed ${m.full_name.split(' ')[0]}`); setActing(null); load(); onCtx(); } catch (e) { toast(e.message, 'error'); }
  };
  const cancelInvite = async (i) => {
    try { await api(`/work/invites/${i.id}`, { method: 'POST', body: { decision: 'cancel' } }); load(); } catch (e) { toast(e.message, 'error'); }
  };
  const newCode = async () => {
    try { await api(`/work/teams/${t.id}/invite-code`, { method: 'POST' }); toast('New invite code created. The old one stops working.'); onCtx(); } catch (e) { toast(e.message, 'error'); }
  };
  const deleteChannel = async (c) => {
    try { await api(`/work/channels/${c.id}`, { method: 'DELETE' }); load(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div style={{ padding: '4px 16px 16px' }}>
      <div className="settings-group">
        <div className="sg-title" style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1 }}>Members · {members?.length ?? '…'}</span>
          {ctx.canInvite && <button className="link-btn" onClick={onInvite}><Icon name="userPlus" size={15} /> Invite</button>}
        </div>
        {!members ? <Spinner /> : members.map((m) => {
          const mood = moodByKey(m.mood_today);
          return (
            <div key={m.id} className="row-item">
              <Avatar user={m} size={42} />
              <div className="meta">
                <div className="title">{m.full_name}{m.id === user.id ? ' (you)' : ''}</div>
                <div className="sub">
                  <span className={`role-tag ${m.team_role}`}>{TEAM_ROLE_LABELS[m.team_role]}</span>
                  {m.active_days_7 !== undefined ? ` · active ${m.active_days_7}/7 days` : ''}
                </div>
              </div>
              {mood && <span title={`Today: ${mood.label}`} style={{ fontSize: 20 }}>{mood.emoji}</span>}
              {ctx.isOwner && m.id !== user.id && <button className="icon-btn" onClick={() => setActing(m)} aria-label={`Manage ${m.full_name}`}><Icon name="more" size={20} /></button>}
            </div>
          );
        })}
      </div>

      {ctx.canInvite && (invites.length > 0 || t.invite_code) && (
        <div className="settings-group">
          <div className="sg-title">Invitations</div>
          {t.invite_code && (
            <div className="code-box" style={{ margin: '4px 0 8px' }}>
              <span><small>Invite code</small><b>{t.invite_code}</b></span>
              <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(t.invite_code).then(() => toast('Code copied'))}><Icon name="link" size={15} /> Copy</button>
              {ctx.canManage && <button className="btn ghost sm" onClick={newCode} title="Make a new code"><Icon name="refresh" size={15} /></button>}
            </div>
          )}
          {invites.map((i) => (
            <div key={i.id} className="row-item">
              {i.user ? <Avatar user={i.user} size={36} /> : <span className="mail-dot"><Icon name="mail" size={17} /></span>}
              <div className="meta"><div className="title">{i.user ? i.user.full_name : i.email}</div><div className="sub">Pending · invited by {i.invited_by?.full_name.split(' ')[0]} · {timeAgo(i.created_at)}</div></div>
              {(ctx.canManage || i.invited_by?.id === user.id) && <button className="btn ghost sm" onClick={() => cancelInvite(i)}>Cancel</button>}
            </div>
          ))}
        </div>
      )}

      <div className="settings-group">
        <div className="sg-title" style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1 }}>Channels</span>
          {ctx.canManage && <button className="link-btn" onClick={() => setSheet('channel')}><Icon name="plus" size={15} /> New channel</button>}
        </div>
        {channels.map((c) => (
          <div key={c.id} className="row-item click" onClick={() => nav(`/chats/${c.id}`)}>
            <span className="chan-hash">#</span>
            <div className="meta"><div className="title">{c.name}</div>{c.description && <div className="sub">{c.description}</div>}</div>
            {ctx.canManage && channels.length > 1 && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); deleteChannel(c); }} aria-label={`Delete #${c.name}`}><Icon name="trash" size={17} /></button>}
            <Icon name="next" size={16} />
          </div>
        ))}
      </div>

      {ctx.canManage && (
        <div className="settings-group">
          <div className="sg-title">Team settings</div>
          <label className="toggle-row"><span><b>Members can post</b><small>Otherwise only the owner and admins post in the Work feed.</small></span>
            <input type="checkbox" className="switch" checked={!!ctx.settings.members_can_post} onChange={(e) => setSetting('members_can_post', e.target.checked)} /></label>
          <label className="toggle-row"><span><b>Members can invite</b><small>Otherwise only the owner and admins invite people.</small></span>
            <input type="checkbox" className="switch" checked={!!ctx.settings.members_can_invite} onChange={(e) => setSetting('members_can_invite', e.target.checked)} /></label>
        </div>
      )}

      <div className="settings-group">
        {ctx.isOwner && <button className="sg-row" onClick={() => setSheet('edit')}><Icon name="edit" size={20} /><span className="sg-label">Edit team<small>Name, logo and description</small></span><Icon name="next" size={17} className="chev" /></button>}
        {ctx.isOwner
          ? <button className="sg-row danger" onClick={() => setConfirm('delete')}><Icon name="trash" size={20} /><span className="sg-label">Delete team</span></button>
          : <button className="sg-row danger" onClick={() => setConfirm('leave')}><Icon name="logout" size={20} /><span className="sg-label">Leave team</span></button>}
      </div>

      {acting && (
        <Sheet title={acting.full_name} onClose={() => setActing(null)}>
          <div className="small muted" style={{ marginTop: -6, marginBottom: 10 }}>{TEAM_ROLE_LABELS[acting.team_role]}</div>
          {acting.team_role !== 'admin' && <button className="sg-row" onClick={() => setRole(acting, 'admin')}><Icon name="shield" size={20} /><span className="sg-label">Make admin<small>Can invite members and manage channels and settings</small></span></button>}
          {acting.team_role === 'admin' && <button className="sg-row" onClick={() => setRole(acting, 'member')}><Icon name="user" size={20} /><span className="sg-label">Make member</span></button>}
          <button className="sg-row" onClick={() => setRole(acting, 'owner')}><Icon name="star" size={20} /><span className="sg-label">Make owner<small>You become an admin</small></span></button>
          <button className="sg-row danger" onClick={() => remove(acting)}><Icon name="userMinus" size={20} /><span className="sg-label">Remove from team</span></button>
        </Sheet>
      )}
      {sheet === 'edit' && <EditTeam team={t} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); onCtx(); }} />}
      {sheet === 'channel' && <NewChannel team={t} onClose={() => setSheet(null)} onCreated={() => { setSheet(null); load(); }} />}
      {confirm === 'leave' && <Confirm title={`Leave ${t.name}?`} danger confirmLabel="Leave team" message="You’ll lose access to the team’s feed, schedule and channels. You can rejoin with an invitation or code."
        onClose={() => setConfirm(null)} onConfirm={async () => { await api(`/work/teams/${t.id}/leave`, { method: 'POST' }); toast(`You left ${t.name}`); onGone(); }} />}
      {confirm === 'delete' && <Confirm title={`Delete ${t.name}?`} danger confirmLabel="Delete team" message="This permanently deletes the team, its feed, schedules, team stories and channels for everyone."
        onClose={() => setConfirm(null)} onConfirm={async () => { await api(`/work/teams/${t.id}`, { method: 'DELETE' }); toast('Team deleted'); onGone(); }} />}
    </div>
  );
}

function EditTeam({ team, onClose, onSaved }) {
  const { toast } = useApp();
  const [f, setF] = useState({ name: team.name, description: team.description || '' });
  const [logo, setLogo] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const form = toForm(f);
      if (logo) form.append('logo', logo);
      await api(`/work/teams/${team.id}`, { method: 'PATCH', form });
      toast('Team updated', 'success'); onSaved();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Edit team" onClose={onClose} footer={<button className="btn block" disabled={busy || !f.name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}>
      <LogoPicker team={team} file={logo} onFile={setLogo} />
      <label className="label">Team name</label>
      <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} />
      <label className="label">Description</label>
      <textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} />
    </Sheet>
  );
}

function NewChannel({ team, onClose, onCreated }) {
  const { toast } = useApp();
  const [f, setF] = useState({ name: '', description: '' });
  const create = async () => {
    try { await api(`/work/teams/${team.id}/channels`, { method: 'POST', body: f }); toast(`#${f.name.replace(/^#/, '')} created`, 'success'); onCreated(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Sheet title="New channel" onClose={onClose} footer={<button className="btn block" disabled={!f.name.trim()} onClick={create}>Create channel</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>Every member of {team.name} joins the channel. Find it in Chats → Teams.</p>
      <label className="label">Name</label>
      <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.replace(/\s+/g, '-').toLowerCase() })} maxLength={40} placeholder="e.g. project-launch" autoFocus />
      <label className="label">Topic <span className="muted">(optional)</span></label>
      <input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} placeholder="What is this channel about?" />
    </Sheet>
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
