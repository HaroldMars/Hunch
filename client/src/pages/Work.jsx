import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { TEAM_ROLES, TEAM_ROLE_LABELS, TEAM_ROLE_INFO } from '@shared/constants.js';
import { ScheduleCalendar, TeamMoodPanel, KINDS, span, ymd, shiftDay, weekStart, parseDay, fmtTime } from '@shared/work/WorkWidgets.jsx';
import { api, toForm } from '../api.js';
import { useApp } from '../store.jsx';
import { Avatar, Sheet, Spinner, Empty, Confirm, FilePreviews, TeamLogo, WorkMood, timeAgo } from '../components/ui.jsx';
import { PostCard } from '../components/Post.jsx';
import { usePhotoEditing } from '../components/ImageEditor.jsx';
import { StoryBar, StoryViewer } from '../components/Stories.jsx';

const RANK = { manager: 4, tl: 3, sme: 2, agent: 1 };
const anRole = (r) => (r === 'sme' ? 'an SME' : r === 'agent' ? 'an Agent' : `a ${TEAM_ROLE_LABELS[r]}`);
const dateLabel = (d, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => parseDay(d).toLocaleDateString(undefined, opts);
const breakSpan = (it) => (it.break_start ? `${fmtTime(it.break_start)} – ${fmtTime(it.break_end)}` : null);

/** Home → Work (Work Mode): your private teams. */
export default function WorkTab({ initialView }) {
  const [teamId, setTeamId] = useState(() => Number(localStorage.getItem('hunch_work_team')) || null);
  const [ctx, setCtx] = useState(null);
  const [view, setView] = useState(initialView === 'schedule' ? 'schedule' : initialView || 'home');
  const [sheet, setSheet] = useState(null); // 'create' | 'join' | 'invites' | 'invite'
  const loadCtx = () => api(`/work/context${teamId ? `?team=${teamId}` : ''}`)
    .then((c) => { if (teamId && !c.team && c.teams?.length) return pick(c.teams[0].id); setCtx(c); })
    .catch(() => setCtx({ team: null, teams: [], invites: 0 }));
  const pick = (id) => { try { localStorage.setItem('hunch_work_team', String(id || '')); } catch { /* private mode */ } setTeamId(id); };
  useEffect(() => { loadCtx(); }, [teamId]);
  if (!ctx) return <Spinner />;
  const sheets = (
    <>
      {sheet === 'create' && <CreateTeam onClose={() => setSheet(null)} onCreated={(t) => { setSheet(null); setView('members'); pick(t.id); loadCtx(); }} />}
      {sheet === 'join' && <JoinTeam onClose={() => setSheet(null)} onJoined={(t) => { setSheet(null); pick(t.id); loadCtx(); }} />}
      {sheet === 'invites' && <MyInvites onClose={() => { setSheet(null); loadCtx(); }} onJoined={(t) => { setSheet(null); pick(t.id); loadCtx(); }} />}
      {sheet === 'invite' && ctx.team && <InviteSheet ctx={ctx} onClose={() => setSheet(null)} />}
    </>
  );
  if (!ctx.team) return <><NoTeam ctx={ctx} onSheet={setSheet} />{sheets}</>;
  const views = [
    ['home', 'Home', 'home'], ['feed', 'Feed', 'cards'], ['chat', 'Chat', 'chat'], ['schedule', 'Schedule', 'clock'], ['calendar', 'Calendar', 'calendar'],
    ['announcements', 'Announcements', 'megaphone'], ['projects', 'Projects', 'layers'], ['members', 'Members', 'users'],
    ...(ctx.canMood ? [['mood', 'Team Mood', 'smile']] : []),
    ...(ctx.canAnalytics ? [['analytics', 'Analytics', 'chart']] : []),
  ];
  const go = (v) => setView(v);
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
          <div className="sub">{ctx.team.members} member{ctx.team.members === 1 ? '' : 's'} · you’re {anRole(ctx.role)}{ctx.isOwner ? ' · owner' : ''}</div>
          {ctx.team.description && <div className="sub wk-desc">{ctx.team.description}</div>}
        </div>
        {ctx.canInvite && <button className="btn sm" onClick={() => setSheet('invite')}><Icon name="userPlus" size={16} /> Invite</button>}
      </div>
      <div className="work-views" role="tablist">
        {views.map(([k, l, i]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => go(k)}><Icon name={i} size={15} /> {l}</button>)}
      </div>
      {view === 'home' && <WorkHome ctx={ctx} onGo={go} />}
      {view === 'feed' && <WorkFeed ctx={ctx} />}
      {view === 'chat' && <WorkChat ctx={ctx} />}
      {view === 'schedule' && <WorkSchedule ctx={ctx} />}
      {view === 'calendar' && <WorkCalendar ctx={ctx} />}
      {view === 'announcements' && <WorkFeed ctx={ctx} only="announcement" />}
      {view === 'projects' && <WorkProjects ctx={ctx} />}
      {view === 'members' && <WorkTeam ctx={ctx} onCtx={loadCtx} onInvite={() => setSheet('invite')} onGone={() => { pick(null); setView('home'); }} />}
      {view === 'mood' && <WorkTeamMood ctx={ctx} />}
      {view === 'analytics' && <WorkAnalytics ctx={ctx} onMood={() => go('mood')} />}
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
      <p>Create a private team for your business, startup, class project, gaming squad or support crew. Only members can see what happens inside.</p>
      {ctx.invites > 0 && (
        <button className="we-invites" onClick={() => onSheet('invites')}>
          <Icon name="mail" size={20} /><span><b>{ctx.invites} team invitation{ctx.invites === 1 ? '' : 's'}</b><small>Review and accept or decline</small></span><Icon name="next" size={17} />
        </button>
      )}
      <div className="we-actions">
        <button className="btn block" onClick={() => onSheet('create')}><Icon name="plus" size={18} /> Create a team</button>
        <button className="btn ghost block" onClick={() => onSheet('join')}><Icon name="key" size={18} /> Join with an invite code</button>
      </div>
      <p className="small muted"><Icon name="lock" size={12} /> Teams, roles and schedules never appear on your public profile.</p>
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

/** Pick one work role. `memberLabel` shows "Member" for Agent, as in team creation. */
function RolePicker({ value, onChange, roles = TEAM_ROLES, memberLabel = false }) {
  return (
    <div className="role-pick" role="radiogroup">
      {roles.map((r) => (
        <button key={r} type="button" role="radio" aria-checked={value === r} className={value === r ? 'on' : ''} onClick={() => onChange(r)}>
          <span className="rp-dot" />
          <span className="rp-text"><b>{r === 'agent' && memberLabel ? 'Member' : TEAM_ROLE_LABELS[r]}</b><small>{TEAM_ROLE_INFO[r]}</small></span>
        </button>
      ))}
    </div>
  );
}

function CreateTeam({ onClose, onCreated }) {
  const { toast } = useApp();
  const [f, setF] = useState({ name: '', description: '', my_role: 'manager', members_can_post: false, members_can_invite: false });
  const [logo, setLogo] = useState(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const form = toForm({ name: f.name, description: f.description, my_role: f.my_role, members_can_post: f.members_can_post ? '1' : '0', members_can_invite: f.members_can_invite ? '1' : '0' });
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
      <label className="label">Team description <span className="muted">(optional)</span></label>
      <textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} placeholder="What is this team for?" />
      <div className="sg-title" style={{ marginTop: 14 }}>Select your role</div>
      <RolePicker value={f.my_role} onChange={(r) => setF({ ...f, my_role: r })} memberLabel />
      <div className="small muted" style={{ margin: '6px 2px 0' }}>You’re the team’s owner whichever role you pick, so you can change it later.</div>
      <div className="sg-title" style={{ marginTop: 14 }}>Team privacy</div>
      <div className="wk-note"><Icon name="lock" size={16} /><span><b>Private team</b><small>Only members see the team, its feed, schedules, chats and members. Teams and roles never show on anyone’s profile.</small></span></div>
      <label className="toggle-row"><span><b>Agents can post</b><small>Otherwise only managers, team leaders and SMEs post in the Work feed.</small></span>
        <input type="checkbox" className="switch" checked={f.members_can_post} onChange={(e) => setF({ ...f, members_can_post: e.target.checked })} /></label>
      <label className="toggle-row"><span><b>Everyone can invite</b><small>Otherwise only managers and team leaders invite people.</small></span>
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
      <p className="small muted" style={{ marginTop: 0 }}>Ask a manager or team leader for the team’s invite code. You join as an Agent; they can change your role.</p>
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
      <div className="small muted" style={{ marginTop: 4 }}>Separate several with commas. People without an account get an email invitation. New members join as Agents.</div>
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

// ---------- Home: my schedule, upcoming shift and meeting, announcements, projects ----------
function WorkHome({ ctx, onGo }) {
  const [d, setD] = useState(null);
  useEffect(() => { setD(null); api(`/work/overview?team=${ctx.team.id}`).then(setD).catch(() => setD({ today: [], announcements: [], projects: [] })); }, [ctx.team.id]);
  if (!d) return <Spinner />;
  const when = (it) => `${it.day === ymd(new Date()) ? 'Today' : it.day === shiftDay(ymd(new Date()), 1) ? 'Tomorrow' : dateLabel(it.day)} · ${span(it)}`;
  return (
    <div className="wh">
      <div className="wh-grid">
        <button className="wh-card" onClick={() => onGo('schedule')}>
          <span className="wh-ic" style={{ '--k': KINDS.shift.color }}><Icon name="clock" size={18} /></span>
          <small>Upcoming shift</small>
          {d.upcomingShift ? <><b>{when(d.upcomingShift)}</b>{breakSpan(d.upcomingShift) && <em>Break {breakSpan(d.upcomingShift)}</em>}</> : <b className="muted">No shift scheduled</b>}
        </button>
        <button className="wh-card" onClick={() => onGo('calendar')}>
          <span className="wh-ic" style={{ '--k': KINDS.meeting.color }}><Icon name="users" size={18} /></span>
          <small>Upcoming meeting</small>
          {d.upcomingMeeting ? <><b>{d.upcomingMeeting.title || KINDS[d.upcomingMeeting.kind]?.label}</b><em>{when(d.upcomingMeeting)}</em></> : <b className="muted">No meetings planned</b>}
        </button>
      </div>

      <div className="wh-section">
        <div className="wh-h"><b>My schedule today</b><button className="link-btn" onClick={() => onGo('schedule')}>My week</button></div>
        {!d.today.length ? <div className="wh-none">Nothing scheduled for you today.</div> : d.today.map((it) => (
          <div key={it.id} className="wh-row" style={{ '--k': KINDS[it.kind]?.color }}>
            <i /><span><b>{it.title || KINDS[it.kind]?.label}</b><small>{span(it)}{breakSpan(it) ? ` · break ${breakSpan(it)}` : ''}{it.user ? '' : ' · whole team'}</small></span>
          </div>
        ))}
      </div>

      <div className="wh-section">
        <div className="wh-h"><b>📣 Announcements</b><button className="link-btn" onClick={() => onGo('announcements')}>See all</button></div>
        {!d.announcements.length ? <div className="wh-none">No announcements yet.</div> : d.announcements.map((p) => (
          <button key={p.id} className="wh-ann" onClick={() => onGo('announcements')}>
            <Avatar user={p.author} size={30} />
            <span><b>{p.author?.full_name}</b> <small>{timeAgo(p.created_at)}</small><em>{p.text || 'Shared a photo'}</em></span>
          </button>
        ))}
      </div>

      <div className="wh-section">
        <div className="wh-h"><b>Active projects</b><button className="link-btn" onClick={() => onGo('projects')}>All projects</button></div>
        {!d.projects.length ? <div className="wh-none">No active projects.</div> : d.projects.map((p) => (
          <button key={p.id} className="wh-row click" onClick={() => onGo('projects')} style={{ '--k': STATUS_COLOR[p.status] }}>
            <i /><span><b>{p.name}</b><small>{p.status_label}{p.due_date ? ` · due ${dateLabel(p.due_date)}` : ''}{p.lead ? ` · ${p.lead.full_name}` : ''}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- feed & announcements ----------
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

function WorkFeed({ ctx, only }) {
  const { user, toast } = useApp();
  const [data, setData] = useState(null);
  const [kind, setKind] = useState(only || 'all');
  const [composing, setComposing] = useState(false);
  useEffect(() => { setKind(only || 'all'); }, [only]);
  const q = `team=${ctx.team.id}${kind !== 'all' ? `&kind=${kind}` : ''}`;
  const load = () => api(`/work/feed?${q}`).then(setData);
  useEffect(() => { setData(null); load(); }, [q]);
  const more = async () => {
    const r = await api(`/work/feed?${q}&before=${data.nextBefore}`);
    setData((d) => ({ ...d, posts: [...d.posts, ...r.posts], nextBefore: r.nextBefore }));
  };
  const announcing = only === 'announcement';
  const canCompose = announcing ? ctx.canAnnounce : ctx.canPost;
  return (
    <>
      {!announcing && <WorkStories teamId={ctx.team.id} />}
      {canCompose ? (
        <button className="composer-trigger work-compose" onClick={() => setComposing(true)}>
          <Avatar user={user} size={32} /><span style={{ flex: 1 }}>{announcing ? 'Post an announcement…' : ctx.canAnnounce ? 'Post an update or announcement…' : 'Share something with your team…'}</span><Icon name={announcing ? 'megaphone' : 'image'} />
        </button>
      ) : (
        <div className="work-perm">
          <Icon name="lock" size={18} />
          <div className="meta"><b>{announcing ? 'Managers and team leaders post announcements' : 'Managers, team leaders and SMEs post here'}</b><small>You can still chat with the team in the Chat tab.</small></div>
        </div>
      )}
      {!only && (
        <div className="chip-row">
          {[['all', 'All'], ['announcement', '📣 Announcements'], ['post', 'Posts']].map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}
        </div>
      )}
      {!data ? <Spinner /> : !data.pinned.length && !data.posts.length ? (
        <Empty icon={announcing ? 'megaphone' : 'briefcase'} title={announcing ? 'No announcements yet' : 'Nothing posted yet'}>{announcing ? 'Announcements also appear in the team’s #announcements channel.' : canCompose ? 'Post an update. Only your team can see it.' : 'Team updates and announcements show up here.'}</Empty>
      ) : (
        <>
          {data.pinned.map((p) => <PostCard key={`pin${p.id}`} post={p} canManage={ctx.canManage} onDeleted={load} />)}
          {data.posts.map((p) => <PostCard key={p.id} post={p} canManage={ctx.canManage} onDeleted={load} />)}
          {data.nextBefore && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn ghost sm" onClick={more}>Load more</button></div>}
        </>
      )}
      {composing && <WorkComposer ctx={ctx} initialKind={announcing ? 'announcement' : 'post'} onClose={() => setComposing(false)} onPosted={(k) => { toast(k === 'announcement' ? 'Announcement posted' : 'Posted to the Work feed', 'success'); load(); }} />}
    </>
  );
}

export function WorkComposer({ ctx, initialKind = 'post', onClose, onPosted }) {
  const { toast } = useApp();
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [kind, setKind] = useState(initialKind);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef();
  const [editPhoto, photoEditor] = usePhotoEditing(files, setFiles);
  const submit = async () => {
    setBusy(true);
    try {
      const f = toForm({ text, kind, team: String(ctx.team.id), pinned: pinned ? '1' : '0' });
      files.forEach((x) => f.append('images', x));
      await api('/work/posts', { method: 'POST', form: f });
      onPosted(kind); onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Sheet title={`Post to ${ctx.team.name}`} onClose={onClose}
      footer={<button className="btn block" disabled={busy || (!text.trim() && !files.length)} onClick={submit}>{busy ? 'Posting…' : kind === 'announcement' ? 'Publish announcement' : 'Post'}</button>}>
      {ctx.canAnnounce && ctx.canPost && (
        <div className="seg" style={{ marginBottom: 10 }}>
          <button className={kind === 'post' ? 'active' : ''} onClick={() => setKind('post')}><Icon name="edit" size={15} /> Update</button>
          <button className={kind === 'announcement' ? 'active' : ''} onClick={() => setKind('announcement')}><Icon name="megaphone" size={15} /> Announcement</button>
        </div>
      )}
      <textarea className="input" rows={5} autoFocus placeholder={kind === 'announcement' ? 'What does the team need to know?' : 'Share an update with your team…'} value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} />
      <FilePreviews files={files} onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} onEdit={editPhoto} />
      {photoEditor}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button className="btn ghost sm" onClick={() => ref.current.click()}><Icon name="image" size={17} /> Photos</button>
        {ctx.canManage && <label className="small" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to top</label>}
      </div>
      <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => { setFiles([...files, ...e.target.files].slice(0, 10)); e.target.value = ''; }} />
      <p className="small muted"><Icon name="lock" size={12} /> Visible only to members of {ctx.team.name}.{kind === 'announcement' ? ' Also posted in #announcements.' : ''}</p>
    </Sheet>
  );
}

// ---------- chat ----------
const CHANNEL_ICON = { general: 'chat', schedules: 'clock', announcements: 'megaphone', meetings: 'users', projects: 'layers' };
function WorkChat({ ctx }) {
  const nav = useNavigate();
  const { toast } = useApp();
  const [channels, setChannels] = useState(null);
  const [convs, setConvs] = useState([]);
  const [adding, setAdding] = useState(false);
  const load = () => {
    api(`/work/teams/${ctx.team.id}/channels`).then(setChannels).catch(() => setChannels([]));
    api('/conversations?scope=teams').then(setConvs).catch(() => setConvs([]));
  };
  useEffect(load, [ctx.team.id]);
  const del = async (c) => { try { await api(`/work/channels/${c.id}`, { method: 'DELETE' }); load(); } catch (e) { toast(e.message, 'error'); } };
  if (!channels) return <Spinner />;
  return (
    <div style={{ padding: '4px 16px 16px' }}>
      <p className="small muted" style={{ margin: '4px 2px 10px' }}>Every member is in every channel. Schedule, meeting, announcement and project updates post into their channel automatically.</p>
      {channels.map((c) => {
        const conv = convs.find((x) => x.id === c.id);
        const lm = conv?.last_message;
        return (
          <div key={c.id} className="row-item click" onClick={() => nav(`/chats/${c.id}`)}>
            <span className="chan-hash">{c.team_channel ? <Icon name={CHANNEL_ICON[c.team_channel]} size={18} /> : '#'}</span>
            <div className="meta">
              <div className="title"><span className="hash">#</span>{c.name}</div>
              <div className={`sub ${conv?.unread ? 'unread' : ''}`}>{lm ? `${lm.kind === 'system' ? '' : `${lm.sender_name || ''}: `}${lm.text}` : c.description || 'No messages yet'}</div>
            </div>
            {conv?.unread > 0 && <span className="pill-count">{conv.unread > 99 ? '99+' : conv.unread}</span>}
            {ctx.canManage && !c.team_channel && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); del(c); }} aria-label={`Delete #${c.name}`}><Icon name="trash" size={17} /></button>}
          </div>
        );
      })}
      {ctx.canManage && <button className="btn ghost block" style={{ marginTop: 10 }} onClick={() => setAdding(true)}><Icon name="plus" size={16} /> New channel</button>}
      {adding && <NewChannel team={ctx.team} onClose={() => setAdding(false)} onCreated={() => { setAdding(false); load(); }} />}
    </div>
  );
}

// ---------- schedule ----------
function WorkSchedule({ ctx }) {
  const [key, setKey] = useState(0);
  const [sheet, setSheet] = useState(null); // { type: 'add', day } | { type: 'week', userId } | { type: 'item', item }
  const reload = () => setKey((k) => k + 1);
  return (
    <div style={{ padding: '4px 16px 16px' }}>
      <MyWeek ctx={ctx} reloadKey={key} onItem={(item) => setSheet({ type: 'item', item })} />
      {ctx.canSchedule && (
        <div className="sched-actions">
          <button className="btn sm" onClick={() => setSheet({ type: 'week' })}><Icon name="calendar" size={16} /> Weekly schedule</button>
          <button className="btn ghost sm" onClick={() => setSheet({ type: 'add', day: ymd(new Date()) })}><Icon name="plus" size={16} /> Create schedule</button>
        </div>
      )}
      <WeeklyRoster ctx={ctx} reloadKey={key} onEdit={ctx.canSchedule ? (userId, week) => setSheet({ type: 'week', userId, week }) : undefined} onItem={(item) => setSheet({ type: 'item', item })} />
      {sheet?.type === 'add' && <ScheduleForm ctx={ctx} day={sheet.day} onClose={() => setSheet(null)} onSaved={reload} />}
      {sheet?.type === 'week' && <WeekForm ctx={ctx} userId={sheet.userId} week={sheet.week} onClose={() => setSheet(null)} onSaved={reload} />}
      {sheet?.type === 'item' && <ScheduleDetail item={sheet.item} manage={ctx.canSchedule} onClose={() => setSheet(null)} onDeleted={() => { setSheet(null); reload(); }} />}
    </div>
  );
}

/** "My schedule": shift, rest day, break, meetings and overtime for the current week. */
function MyWeek({ ctx, reloadKey, onItem }) {
  const { user } = useApp();
  const [list, setList] = useState(null);
  const from = weekStart(ymd(new Date()));
  useEffect(() => { api(`/work/schedules?team=${ctx.team.id}&from=${from}&to=${shiftDay(from, 6)}&user=${user.id}`).then(setList); }, [reloadKey, ctx.team.id]);
  if (!list) return null;
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(from, i));
  return (
    <div className="my-week">
      <div className="mw-title"><b>My schedule</b><span>{dateLabel(from, { month: 'short', day: 'numeric' })} – {dateLabel(days[6], { month: 'short', day: 'numeric' })}</span></div>
      {days.map((d) => {
        const items = list.filter((x) => x.day === d);
        const shift = items.find((x) => x.kind === 'shift');
        const rest = items.find((x) => x.kind === 'rest');
        const extra = items.filter((x) => x !== shift && x !== rest);
        return (
          <div key={d} className={`mw-row ${d === ymd(new Date()) ? 'today' : ''}`}>
            <span className="d">{dateLabel(d, { weekday: 'short' })}</span>
            <span className="s">{rest ? <em>OFF</em> : shift ? <button className="mw-shift" onClick={() => onItem(shift)}>{span(shift)}{breakSpan(shift) && <small> · break {breakSpan(shift)}</small>}</button> : <em className="muted">-</em>}</span>
            <span className="x">{extra.map((x) => <i key={x.id} role="button" tabIndex={0} onClick={() => onItem(x)} style={{ '--k': KINDS[x.kind]?.color }} title={`${x.title || KINDS[x.kind]?.label} · ${span(x)}`}>{x.title || KINDS[x.kind]?.label} {x.start_time ? fmtTime(x.start_time) : ''}</i>)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Weekly schedule: one row per employee, Monday to Sunday (shift times or OFF). Agents see their own row. */
function WeeklyRoster({ ctx, reloadKey, onEdit, onItem }) {
  const { user } = useApp();
  const [week, setWeek] = useState(() => weekStart(ymd(new Date())));
  const [items, setItems] = useState(null);
  const [members, setMembers] = useState([]);
  const [allTeam, setAllTeam] = useState(false);
  useEffect(() => { api(`/work/members?team=${ctx.team.id}`).then(setMembers); }, [ctx.team.id]);
  useEffect(() => { setItems(null); api(`/work/schedules?team=${ctx.team.id}&from=${week}&to=${shiftDay(week, 6)}`).then(setItems); }, [week, reloadKey, ctx.team.id]);
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(week, i));
  const people = ctx.canSchedule ? members : members.filter((m) => m.id === user.id);
  const cell = (uid, d) => {
    const mine = (items || []).filter((x) => x.day === d && x.user_id === uid);
    const rest = mine.find((x) => x.kind === 'rest');
    const shift = mine.find((x) => x.kind === 'shift' || x.kind === 'overtime');
    if (rest) return <button className="wr-off" onClick={() => onItem(rest)}>OFF</button>;
    if (shift) return <button className="wr-shift" onClick={() => onItem(shift)}><b>{fmtTime(shift.start_time).replace(':00', '')}</b><span>{fmtTime(shift.end_time).replace(':00', '')}</span></button>;
    return <span className="wr-none">-</span>;
  };
  const teamWide = (items || []).filter((x) => !x.user_id);
  return (
    <div className="roster">
      <div className="wr-head">
        <button className="icon-btn" onClick={() => setWeek(shiftDay(week, -7))} aria-label="Previous week"><Icon name="back" size={18} /></button>
        <b>Weekly schedule · {dateLabel(week, { month: 'short', day: 'numeric' })} – {dateLabel(days[6], { month: 'short', day: 'numeric' })}</b>
        <button className="icon-btn" onClick={() => setWeek(shiftDay(week, 7))} aria-label="Next week"><Icon name="next" size={18} /></button>
      </div>
      {!items ? <Spinner /> : (
        <div className="wr-scroll">
          <table className="wr-table">
            <thead><tr><th>Employee</th>{days.map((d) => <th key={d} className={d === ymd(new Date()) ? 'today' : ''}>{dateLabel(d, { weekday: 'short' })}<small>{parseDay(d).getDate()}</small></th>)}</tr></thead>
            <tbody>
              {people.map((m) => (
                <tr key={m.id}>
                  <th>
                    <button className="wr-who" onClick={() => onEdit?.(m.id, week)} disabled={!onEdit}>
                      <Avatar user={m} size={26} /><span><b>{m.full_name.split(' ')[0]}{m.id === user.id ? ' (you)' : ''}</b><small>{TEAM_ROLE_LABELS[m.team_role]}</small></span>
                    </button>
                  </th>
                  {days.map((d) => <td key={d}>{cell(m.id, d)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {teamWide.length > 0 && (
        <div className="wr-team">
          <div className="small muted" style={{ fontWeight: 700, margin: '8px 2px 4px' }}>Whole team this week</div>
          {(allTeam ? teamWide : teamWide.slice(0, 5)).map((x) => (
            <button key={x.id} className="wh-row click" style={{ '--k': KINDS[x.kind]?.color }} onClick={() => onItem(x)}>
              <i /><span><b>{x.title || KINDS[x.kind]?.label}</b><small>{dateLabel(x.day)} · {span(x)}</small></span>
            </button>
          ))}
          {teamWide.length > 5 && <button className="link-btn small" onClick={() => setAllTeam(!allTeam)}>{allTeam ? 'Show less' : `Show all ${teamWide.length}`}</button>}
        </div>
      )}
      {onEdit && people.length > 0 && <div className="small muted" style={{ margin: '8px 2px 0' }}>Tap a name to set their week.</div>}
    </div>
  );
}

function TimeRow({ label, start, end, onStart, onEnd, optional }) {
  return (
    <div className="time-row">
      <label className="label">{label}{optional && <span className="muted"> (optional)</span>}</label>
      <div><input className="input" type="time" value={start} onChange={(e) => onStart(e.target.value)} aria-label={`${label} start`} /><span>to</span><input className="input" type="time" value={end} onChange={(e) => onEnd(e.target.value)} aria-label={`${label} end`} /></div>
    </div>
  );
}

/** Create schedule: employee, date, start, end, break, remarks (optionally repeated on chosen weekdays). */
export function ScheduleForm({ ctx, day, initialKind = 'shift', onClose, onSaved }) {
  const { toast } = useApp();
  const [members, setMembers] = useState([]);
  useEffect(() => { api(`/work/members?team=${ctx.team.id}`).then(setMembers); }, []);
  const meeting = initialKind === 'meeting';
  const [f, setF] = useState({ kind: initialKind, title: '', start_time: meeting ? '09:00' : '08:00', end_time: meeting ? '09:30' : '17:00', break_start: '12:00', break_end: '13:00', notes: '', who: meeting ? 'team' : 'people', users: [], day, repeat: [], weeks: 1 });
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
  const withBreak = f.kind === 'shift' || f.kind === 'overtime';
  const save = async () => {
    try {
      const body = {
        team: ctx.team.id, kind: f.kind, title: f.title, remarks: f.notes, start_time: f.start_time, end_time: f.end_time, days: dates(),
        ...(withBreak && f.break_start && f.break_end ? { break_start: f.break_start, break_end: f.break_end } : {}),
        ...(f.who === 'people' ? { user_ids: f.users } : {}),
      };
      const r = await api('/work/schedules', { method: 'POST', body });
      toast(`Added ${r.length} schedule ${r.length === 1 ? 'item' : 'items'}`, 'success');
      onSaved(); onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  const n = dates().length * (f.who === 'people' ? f.users.length : 1);
  return (
    <Sheet title="Create schedule" onClose={onClose} footer={<button className="btn block" disabled={!n} onClick={save}>{n > 1 ? `Add ${n} items` : 'Add to schedule'}</button>}>
      <label className="label" style={{ marginTop: 0 }}>Employee</label>
      <div className="seg">
        <button className={f.who === 'people' ? 'active' : ''} onClick={() => setF({ ...f, who: 'people' })}><Icon name="user" size={15} /> Choose people</button>
        <button className={f.who === 'team' ? 'active' : ''} onClick={() => setF({ ...f, who: 'team' })}><Icon name="users" size={15} /> Whole team</button>
      </div>
      {f.who === 'people' && <div className="pick-list">{members.map((m) => (
        <div key={m.id} className={`check-row ${f.users.includes(m.id) ? 'on' : ''}`} onClick={() => setF({ ...f, users: f.users.includes(m.id) ? f.users.filter((x) => x !== m.id) : [...f.users, m.id] })}>
          <Avatar user={m} size={32} /><div style={{ flex: 1, fontWeight: 600 }}>{m.full_name} <span className="muted small">{TEAM_ROLE_LABELS[m.team_role]}</span></div><span className="box"><Icon name="check" size={14} /></span>
        </div>
      ))}</div>}
      <label className="label">Type</label>
      <div className="kind-grid">
        {Object.entries(KINDS).map(([k, v]) => (
          <button key={k} className={f.kind === k ? 'on' : ''} style={{ '--k': v.color }} onClick={() => setF({ ...f, kind: k, start_time: presets[k][0], end_time: presets[k][1] })}><i />{v.label}</button>
        ))}
      </div>
      {f.kind !== 'shift' && f.kind !== 'rest' && <>
        <label className="label">Title <span className="muted">(optional)</span></label>
        <input className="input" value={f.title} onChange={set('title')} maxLength={80} placeholder={f.kind === 'meeting' ? 'e.g. Weekly huddle' : f.kind === 'coaching' ? 'e.g. 1:1 coaching' : ''} />
      </>}
      <label className="label">Date</label>
      <input className="input" type="date" value={f.day} onChange={set('day')} />
      {f.kind !== 'rest' && <TimeRow label="Time" start={f.start_time} end={f.end_time} onStart={(v) => setF({ ...f, start_time: v })} onEnd={(v) => setF({ ...f, end_time: v })} />}
      {withBreak && <TimeRow label="Break time" optional start={f.break_start} end={f.break_end} onStart={(v) => setF({ ...f, break_start: v })} onEnd={(v) => setF({ ...f, break_end: v })} />}
      <label className="label">Repeat on</label>
      <div className="dow-row">{dows.map((d, i) => <button key={d} className={f.repeat.includes(i) ? 'on' : ''} onClick={() => setF({ ...f, repeat: f.repeat.includes(i) ? f.repeat.filter((x) => x !== i) : [...f.repeat, i] })} aria-label={d}>{d[0]}</button>)}</div>
      {f.repeat.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>for <select value={f.weeks} onChange={set('weeks')}>{[1, 2, 3, 4, 6, 8].map((w) => <option key={w} value={w}>{w}</option>)}</select> week(s) · {dates().length} dates</div>}
      <label className="label">Remarks</label>
      <textarea className="input" rows={2} value={f.notes} onChange={set('notes')} maxLength={500} placeholder="Station, meeting link or agenda (optional)" />
    </Sheet>
  );
}

/** Weekly schedule for one employee: Monday–Sunday, each day a shift with a break, or OFF. */
export function WeekForm({ ctx, userId, week: initialWeek, onClose, onSaved }) {
  const { toast } = useApp();
  const [members, setMembers] = useState([]);
  const [who, setWho] = useState(userId || '');
  const [week, setWeek] = useState(initialWeek || weekStart(ymd(new Date())));
  const blank = (i) => ({ off: i >= 5, start_time: '08:00', end_time: '17:00', break_start: '12:00', break_end: '13:00' });
  const [days, setDays] = useState(() => Array.from({ length: 7 }, (_, i) => blank(i)));
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/work/members?team=${ctx.team.id}`).then(setMembers); }, []);
  // Start from what's already scheduled for that person and week.
  useEffect(() => {
    if (!who) return;
    api(`/work/schedules?team=${ctx.team.id}&from=${week}&to=${shiftDay(week, 6)}&user=${who}`).then((list) => {
      setDays(Array.from({ length: 7 }, (_, i) => {
        const d = shiftDay(week, i);
        const mine = list.filter((x) => x.day === d && x.user_id === Number(who));
        const s = mine.find((x) => x.kind === 'shift');
        if (mine.find((x) => x.kind === 'rest')) return { ...blank(i), off: true };
        if (s) return { off: false, start_time: s.start_time, end_time: s.end_time, break_start: s.break_start || '', break_end: s.break_end || '' };
        return blank(i);
      }));
    });
  }, [who, week]);
  const setDay = (i, patch) => setDays(days.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const copyMonday = () => setDays(days.map((d, i) => (i > 0 && i < 5 ? { ...days[0] } : d)));
  const save = async () => {
    setBusy(true);
    try {
      await api('/work/schedules/week', { method: 'POST', body: {
        team: ctx.team.id, user_ids: [Number(who)], remarks,
        days: days.map((d, i) => ({ day: shiftDay(week, i), off: d.off, start_time: d.start_time, end_time: d.end_time, ...(d.break_start && d.break_end ? { break_start: d.break_start, break_end: d.break_end } : {}) })),
      } });
      toast('Weekly schedule saved', 'success');
      onSaved(); onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const person = members.find((m) => m.id === Number(who));
  return (
    <Sheet title="Weekly schedule" onClose={onClose} footer={<button className="btn block" disabled={busy || !who} onClick={save}>{busy ? 'Saving…' : `Save ${person ? `${person.full_name.split(' ')[0]}’s` : ''} week`}</button>}>
      <label className="label" style={{ marginTop: 0 }}>Employee</label>
      <select className="input" value={who} onChange={(e) => setWho(e.target.value)}>
        <option value="">Choose an employee</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.full_name} · {TEAM_ROLE_LABELS[m.team_role]}</option>)}
      </select>
      <div className="wf-week">
        <button className="icon-btn" onClick={() => setWeek(shiftDay(week, -7))} aria-label="Previous week"><Icon name="back" size={18} /></button>
        <b>Week of {dateLabel(week, { month: 'long', day: 'numeric' })}</b>
        <button className="icon-btn" onClick={() => setWeek(shiftDay(week, 7))} aria-label="Next week"><Icon name="next" size={18} /></button>
      </div>
      {days.map((d, i) => (
        <div key={i} className={`wf-day ${d.off ? 'off' : ''}`}>
          <div className="wf-top">
            <b>{dateLabel(shiftDay(week, i), { weekday: 'long' })}</b>
            <div className="seg sm">
              <button className={!d.off ? 'active' : ''} onClick={() => setDay(i, { off: false })}>Work</button>
              <button className={d.off ? 'active' : ''} onClick={() => setDay(i, { off: true })}>OFF</button>
            </div>
          </div>
          {!d.off && (
            <div className="wf-times">
              <span><small>Shift</small><input type="time" value={d.start_time} onChange={(e) => setDay(i, { start_time: e.target.value })} aria-label="Shift start" />–<input type="time" value={d.end_time} onChange={(e) => setDay(i, { end_time: e.target.value })} aria-label="Shift end" /></span>
              <span><small>Break</small><input type="time" value={d.break_start} onChange={(e) => setDay(i, { break_start: e.target.value })} aria-label="Break start" />–<input type="time" value={d.break_end} onChange={(e) => setDay(i, { break_end: e.target.value })} aria-label="Break end" /></span>
            </div>
          )}
        </div>
      ))}
      <button className="link-btn small" onClick={copyMonday} style={{ marginTop: 8 }}>Copy Monday to Tuesday–Friday</button>
      <label className="label">Remarks</label>
      <textarea className="input" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} placeholder="Optional, e.g. covering for Ana on Thursday" />
      <p className="small muted">Saving replaces this person’s shifts and days off for the week. The update is posted in #schedules.</p>
    </Sheet>
  );
}

function ScheduleDetail({ item, manage, onClose, onDeleted }) {
  const [confirm, setConfirm] = useState(false);
  const k = KINDS[item.kind];
  return (
    <Sheet title={item.title || k.label} onClose={onClose}
      footer={manage && <button className="btn ghost block" style={{ color: 'var(--danger)' }} onClick={() => setConfirm(true)}><Icon name="trash" size={17} /> Remove</button>}>
      <div className="about-row"><Icon name="calendar" size={18} /><span>Date</span><b>{dateLabel(item.day, { weekday: 'long', month: 'long', day: 'numeric' })}</b></div>
      <div className="about-row"><Icon name="clock" size={18} /><span>Time</span><b>{item.kind === 'rest' ? 'OFF' : span(item)}</b></div>
      {breakSpan(item) && <div className="about-row"><Icon name="smile" size={18} /><span>Break</span><b>{breakSpan(item)}</b></div>}
      <div className="about-row"><i style={{ width: 18, height: 18, borderRadius: 5, background: k.color, display: 'inline-block' }} /><span>Type</span><b>{k.label}</b></div>
      <div className="about-row"><Icon name="users" size={18} /><span>Employee</span><b>{item.user ? item.user.full_name : 'Whole team'}</b></div>
      {item.notes && <><div className="sg-title" style={{ marginTop: 10 }}>Remarks</div><p style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{item.notes}</p></>}
      {confirm && <Confirm title="Remove this schedule item?" danger confirmLabel="Remove" message="The removal is posted in the team’s schedule channel." onClose={() => setConfirm(false)}
        onConfirm={async () => { await api(`/work/schedules/${item.id}`, { method: 'DELETE' }); onDeleted(); }} />}
    </Sheet>
  );
}

function WorkCalendar({ ctx }) {
  const { user } = useApp();
  const [key, setKey] = useState(0);
  const [adding, setAdding] = useState(null);
  const [item, setItem] = useState(null);
  const [mineOnly, setMineOnly] = useState(!ctx.canSchedule);
  const load = (from, to) => api(`/work/schedules?team=${ctx.team.id}&from=${from}&to=${to}${mineOnly && ctx.canSchedule ? `&user=${user.id}` : ''}`);
  return (
    <div style={{ padding: '4px 16px 16px' }}>
      {ctx.canSchedule && (
        <div className="chip-row" style={{ padding: '4px 0 10px' }}>
          <button className={!mineOnly ? 'on' : ''} onClick={() => setMineOnly(false)}>Whole team</button>
          <button className={mineOnly ? 'on' : ''} onClick={() => setMineOnly(true)}>Just me</button>
        </div>
      )}
      <ScheduleCalendar load={load} reloadKey={`${key}-${mineOnly}`} showWho={ctx.canSchedule} onAdd={ctx.canSchedule ? (day) => setAdding(day) : undefined} onItem={setItem} />
      {adding && <ScheduleForm ctx={ctx} day={adding} onClose={() => setAdding(null)} onSaved={() => setKey((k) => k + 1)} />}
      {item && <ScheduleDetail item={item} manage={ctx.canSchedule} onClose={() => setItem(null)} onDeleted={() => { setItem(null); setKey((k) => k + 1); }} />}
    </div>
  );
}

// ---------- projects ----------
const STATUS = [['planning', 'Planning'], ['active', 'In progress'], ['on_hold', 'On hold'], ['done', 'Done']];
const STATUS_COLOR = { planning: '#a78bfa', active: '#5b8def', on_hold: '#f59e0b', done: '#1baf7a' };
function WorkProjects({ ctx }) {
  const { user, toast } = useApp();
  const [list, setList] = useState(null);
  const [filter, setFilter] = useState('open');
  const [edit, setEdit] = useState(null); // {} for new, project to edit
  const load = () => api(`/work/projects?team=${ctx.team.id}`).then(setList);
  useEffect(() => { setList(null); load(); }, [ctx.team.id]);
  const setStatus = async (p, status) => {
    try { await api(`/work/projects/${p.id}`, { method: 'PATCH', body: { status } }); load(); } catch (e) { toast(e.message, 'error'); }
  };
  const shown = (list || []).filter((p) => (filter === 'open' ? p.status !== 'done' : filter === 'done' ? p.status === 'done' : true));
  return (
    <div style={{ padding: '4px 16px 16px' }}>
      <div className="chip-row" style={{ padding: '4px 0 10px' }}>
        {[['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
        {ctx.canManage && <button style={{ marginLeft: 'auto' }} onClick={() => setEdit({})}><Icon name="plus" size={14} /> New project</button>}
      </div>
      {!list ? <Spinner /> : !shown.length ? (
        <Empty icon="layers" title={filter === 'done' ? 'No finished projects' : 'No projects yet'}>{ctx.canManage ? 'Track what the team is working on. Updates post in #projects.' : 'Managers and team leaders add the team’s projects here.'}</Empty>
      ) : shown.map((p) => {
        const canStatus = ctx.canManage || p.lead?.id === user.id;
        return (
          <div key={p.id} className="project" style={{ '--k': STATUS_COLOR[p.status] }}>
            <div className="pj-top">
              <b>{p.name}</b>
              {canStatus ? (
                <select className="pj-status" value={p.status} onChange={(e) => setStatus(p, e.target.value)} aria-label="Status">{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              ) : <span className="pj-status">{p.status_label}</span>}
            </div>
            {p.description && <p>{p.description}</p>}
            <div className="pj-meta">
              {p.lead && <span><Avatar user={p.lead} size={18} /> {p.lead.full_name}</span>}
              {p.due_date && <span className={p.status !== 'done' && p.due_date < ymd(new Date()) ? 'late' : ''}><Icon name="calendar" size={13} /> Due {dateLabel(p.due_date)}</span>}
              {ctx.canManage && <button className="link-btn" onClick={() => setEdit(p)}>Edit</button>}
            </div>
          </div>
        );
      })}
      {edit && <ProjectForm ctx={ctx} project={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function ProjectForm({ ctx, project, onClose, onSaved }) {
  const { toast } = useApp();
  const [members, setMembers] = useState([]);
  const [confirm, setConfirm] = useState(false);
  const [f, setF] = useState({ name: project.name || '', description: project.description || '', status: project.status || 'active', due_date: project.due_date || '', lead_id: project.lead?.id || '' });
  useEffect(() => { api(`/work/members?team=${ctx.team.id}`).then(setMembers); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      const body = { ...f, lead_id: f.lead_id || null, due_date: f.due_date || null };
      if (project.id) await api(`/work/projects/${project.id}`, { method: 'PATCH', body });
      else await api('/work/projects', { method: 'POST', body: { ...body, team: ctx.team.id } });
      toast(project.id ? 'Project updated' : 'Project created', 'success'); onSaved();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Sheet title={project.id ? 'Edit project' : 'New project'} onClose={onClose}
      footer={<div style={{ display: 'flex', gap: 8 }}>
        {project.id && <button className="btn ghost" style={{ color: 'var(--danger)' }} onClick={() => setConfirm(true)}><Icon name="trash" size={17} /></button>}
        <button className="btn block" disabled={!f.name.trim()} onClick={save}>{project.id ? 'Save' : 'Create project'}</button>
      </div>}>
      <label className="label" style={{ marginTop: 0 }}>Project name</label>
      <input className="input" value={f.name} onChange={set('name')} maxLength={80} placeholder="e.g. Holiday campaign" autoFocus />
      <label className="label">Description <span className="muted">(optional)</span></label>
      <textarea className="input" rows={3} value={f.description} onChange={set('description')} maxLength={1000} />
      <label className="label">Status</label>
      <div className="seg">{STATUS.map(([k, l]) => <button key={k} className={f.status === k ? 'active' : ''} onClick={() => setF({ ...f, status: k })}>{l}</button>)}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}><label className="label">Due date</label><input className="input" type="date" value={f.due_date} onChange={set('due_date')} /></div>
        <div style={{ flex: 1 }}><label className="label">Lead</label>
          <select className="input" value={f.lead_id} onChange={set('lead_id')}><option value="">No lead</option>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select>
        </div>
      </div>
      {confirm && <Confirm title={`Delete “${project.name}”?`} danger confirmLabel="Delete" message="This removes the project for the whole team." onClose={() => setConfirm(false)}
        onConfirm={async () => { await api(`/work/projects/${project.id}`, { method: 'DELETE' }); onSaved(); }} />}
    </Sheet>
  );
}

// ---------- members ----------
/** Members and roles, invitations, settings, and leaving or deleting the team. */
function WorkTeam({ ctx, onCtx, onInvite, onGone }) {
  const { user, toast } = useApp();
  const [members, setMembers] = useState(null);
  const [invites, setInvites] = useState([]);
  const [acting, setActing] = useState(null); // member whose menu is open
  const [sheet, setSheet] = useState(null); // 'edit'
  const [confirm, setConfirm] = useState(null); // 'leave' | 'delete' | { owner: member }
  const t = ctx.team;
  const load = () => {
    api(`/work/members?team=${t.id}`).then(setMembers);
    if (ctx.canInvite) api(`/work/teams/${t.id}/invites`).then(setInvites).catch(() => setInvites([]));
  };
  useEffect(load, [t.id]);
  const setSetting = async (k, v) => {
    try { await api(`/work/teams/${t.id}`, { method: 'PATCH', body: { [k]: v ? '1' : '0' } }); onCtx(); } catch (e) { toast(e.message, 'error'); }
  };
  const first = (m) => (m.id === user.id ? 'You' : m.full_name.split(' ')[0]);
  const setRole = async (m, role) => {
    try {
      await api(`/work/teams/${t.id}/members/${m.id}`, { method: 'PATCH', body: { role } });
      toast(`${first(m)} ${m.id === user.id ? 'are' : 'is'} now ${anRole(role)}`, 'success');
      setActing(null); load(); onCtx();
    } catch (e) { toast(e.message, 'error'); }
  };
  const makeOwner = async (m) => {
    try {
      await api(`/work/teams/${t.id}/members/${m.id}`, { method: 'PATCH', body: { owner: true } });
      toast(`${first(m)} now owns ${t.name}`, 'success'); setConfirm(null); setActing(null); load(); onCtx();
    } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (m) => {
    try { await api(`/work/teams/${t.id}/members/${m.id}`, { method: 'DELETE' }); toast(`Removed ${first(m)}`); setActing(null); load(); onCtx(); } catch (e) { toast(e.message, 'error'); }
  };
  const cancelInvite = async (i) => {
    try { await api(`/work/invites/${i.id}`, { method: 'POST', body: { decision: 'cancel' } }); load(); } catch (e) { toast(e.message, 'error'); }
  };
  const newCode = async () => {
    try { await api(`/work/teams/${t.id}/invite-code`, { method: 'POST' }); toast('New invite code created. The old one stops working.'); onCtx(); } catch (e) { toast(e.message, 'error'); }
  };
  // The owner acts on anyone (and sets their own role); others only on people ranked below them.
  const outranks = (m) => ctx.isOwner || (!m.is_owner && RANK[ctx.role] > RANK[m.team_role]);
  const canAct = (m) => (m.id === user.id ? ctx.isOwner : (ctx.canAssign || ctx.canManage) && outranks(m));
  const groups = TEAM_ROLES.map((r) => [r, (members || []).filter((m) => m.team_role === r)]).filter(([, l]) => l.length);
  return (
    <div style={{ padding: '4px 16px 16px' }}>
      <div className="settings-group">
        <div className="sg-title" style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1 }}>Team structure · {members?.length ?? '…'}</span>
          {ctx.canInvite && <button className="link-btn" onClick={onInvite}><Icon name="userPlus" size={15} /> Invite</button>}
        </div>
        {!members ? <Spinner /> : (
          <div className="hierarchy">
            {groups.map(([r, list]) => (
              <div key={r} className={`hz-level lv-${r}`}>
                <div className="hz-label"><span className={`role-tag ${r}`}>{TEAM_ROLE_LABELS[r]}{list.length > 1 && r !== 'manager' ? 's' : ''}</span><small>{list.length}</small></div>
                {list.map((m) => {
                  const { mood } = m;
                  return (
                    <div key={m.id} className="row-item">
                      <Avatar user={m} size={40} />
                      <div className="meta">
                        <div className="title">{m.full_name}{m.id === user.id ? ' (you)' : ''}{m.is_owner && <span className="role-tag owner" style={{ marginLeft: 6 }}>Owner</span>}</div>
                        <div className="sub">{m.active_days_7 !== undefined ? `Active ${m.active_days_7}/7 days${m.last_active_at ? ` · last seen ${timeAgo(m.last_active_at)}` : ''}` : TEAM_ROLE_LABELS[m.team_role]}</div>
                      </div>
                      {mood && <span className="member-mood" title={`${mood.label}${mood.note ? `: ${mood.note}` : ''}`}>{mood.emoji}</span>}
                      {canAct(m) && <button className="icon-btn" onClick={() => setActing(m)} aria-label={`Manage ${m.full_name}`}><Icon name="more" size={20} /></button>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {ctx.canInvite && (invites.length > 0 || t.invite_code) && (
        <div className="settings-group">
          <div className="sg-title">Invitations</div>
          {t.invite_code && (
            <div className="code-box" style={{ margin: '4px 0 8px' }}>
              <span><small>Invite code</small><b>{t.invite_code}</b></span>
              <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(t.invite_code).then(() => toast('Code copied'))}><Icon name="link" size={15} /> Copy</button>
              {ctx.canManage && <button className="btn ghost sm" onClick={newCode} title="Make a new code" aria-label="Make a new invite code"><Icon name="refresh" size={15} /></button>}
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

      {ctx.canEditSettings && (
        <div className="settings-group">
          <div className="sg-title">Team privacy & settings</div>
          <div className="wk-note"><Icon name="lock" size={16} /><span><b>Private team</b><small>Teams, roles, schedules, the Work feed, analytics and team chats are only visible to members.</small></span></div>
          <label className="toggle-row"><span><b>Agents can post</b><small>Otherwise only managers, team leaders and SMEs post in the Work feed.</small></span>
            <input type="checkbox" className="switch" checked={!!ctx.settings.members_can_post} onChange={(e) => setSetting('members_can_post', e.target.checked)} /></label>
          <label className="toggle-row"><span><b>Everyone can invite</b><small>Otherwise only managers and team leaders invite people.</small></span>
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
        <Sheet title={acting.id === user.id ? 'Your role' : acting.full_name} onClose={() => setActing(null)}>
          <div className="small muted" style={{ marginTop: -6, marginBottom: 10 }}>{TEAM_ROLE_LABELS[acting.team_role]}{acting.is_owner ? ' · Owner' : ''}</div>
          {(ctx.canAssign || acting.id === user.id) && <>
            <div className="sg-title">{acting.id === user.id ? 'Change my role' : 'Change role'}</div>
            <RolePicker value={acting.team_role} onChange={(r) => r !== acting.team_role && setRole(acting, r)} roles={ctx.isOwner ? TEAM_ROLES : TEAM_ROLES.filter((r) => RANK[r] < RANK[ctx.role] || (r === 'manager' && ctx.role === 'manager'))} />
          </>}
          {acting.id !== user.id && <div style={{ marginTop: 10 }}>
            {ctx.isOwner && <button className="sg-row" onClick={() => setConfirm({ owner: acting })}><Icon name="star" size={20} /><span className="sg-label">Make owner<small>They can edit or delete the team. You keep your role.</small></span></button>}
            {ctx.canManage && <button className="sg-row danger" onClick={() => remove(acting)}><Icon name="userMinus" size={20} /><span className="sg-label">Remove from team</span></button>}
          </div>}
        </Sheet>
      )}
      {sheet === 'edit' && <EditTeam team={t} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); onCtx(); }} />}
      {confirm?.owner && <Confirm title={`Make ${confirm.owner.full_name.split(' ')[0]} the owner?`} confirmLabel="Transfer ownership" message={`They’ll be able to edit or delete ${t.name}. You stay on the team as ${anRole(ctx.role)}.`}
        onClose={() => setConfirm(null)} onConfirm={() => makeOwner(confirm.owner)} />}
      {confirm === 'leave' && <Confirm title={`Leave ${t.name}?`} danger confirmLabel="Leave team" message="You’ll lose access to the team’s feed, schedule and channels. You can rejoin with an invitation or code."
        onClose={() => setConfirm(null)} onConfirm={async () => { await api(`/work/teams/${t.id}/leave`, { method: 'POST' }); toast(`You left ${t.name}`); onGone(); }} />}
      {confirm === 'delete' && <Confirm title={`Delete ${t.name}?`} danger confirmLabel="Delete team" message="This permanently deletes the team, its feed, schedules, projects, team stories and channels for everyone."
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
      <p className="small muted" style={{ marginTop: 0 }}>Every member of {team.name} joins the channel. Find it here and in Chats → Teams.</p>
      <label className="label">Name</label>
      <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.replace(/\s+/g, '-').toLowerCase() })} maxLength={40} placeholder="e.g. project-launch" autoFocus />
      <label className="label">Topic <span className="muted">(optional)</span></label>
      <input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} placeholder="What is this channel about?" />
    </Sheet>
  );
}

// ---------- team mood (managers, team leaders and SMEs) ----------
const relDay = (day) => {
  const diff = Math.round((parseDay(ymd(new Date())) - parseDay(day)) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : `${diff} days ago`;
};
function WorkTeamMood({ ctx }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [period, setPeriod] = useState('week');
  const load = () => api(`/work/mood?team=${ctx.team.id}`).then(setData).catch(setErr);
  useEffect(() => { setData(null); load(); }, [ctx.team.id]);
  if (err) return <Empty icon="lock" title="Not available">{err.message}</Empty>;
  if (!data) return <Spinner />;
  const dist = period === 'week' ? data.week.distribution : data.today.distribution;
  return (
    <div style={{ padding: '4px 16px 16px' }}>
      <div className="wk-note" style={{ marginBottom: 10 }}><Icon name="lock" size={16} /><span><b>Team wellbeing</b><small>Moods from teammates with Work Mode on. {data.optedOut > 0 ? `${data.optedOut} member${data.optedOut === 1 ? ' has' : 's have'} Work Mode off and ${data.optedOut === 1 ? 'isn’t' : 'aren’t'} included.` : 'Only your team’s managers, team leaders and SMEs see this page.'}</small></span></div>

      <div className="an-card">
        <div className="tm-h"><b>Team Mood Summary</b>
          <div className="seg sm">{[['today', 'Today'], ['week', '7 days']].map(([k, l]) => <button key={k} className={period === k ? 'active' : ''} onClick={() => setPeriod(k)}>{l}</button>)}</div>
        </div>
        {!dist.length ? <div className="wh-none">No mood check-ins {period === 'today' ? 'today' : 'this week'} yet.</div> : (
          <div className="tm-dist">
            {dist.map((m) => (
              <div key={m.mood} className="tm-row"><span className="l">{m.emoji} {m.label}</span><span className="t"><i style={{ width: `${m.pct}%` }} /></span><b>{m.pct}%</b></div>
            ))}
          </div>
        )}
      </div>

      <div className="an-card">
        <b>Current moods & history</b>
        {!data.people.length ? <div className="wh-none">No teammates have Work Mode on yet.</div> : data.people.map((p) => (
          <div key={p.user.id} className="tm-person">
            <Avatar user={p.user} size={38} />
            <div className="tm-main">
              <div className="tm-name"><b>{p.user.full_name}</b><span className={`role-tag ${p.role}`}>{TEAM_ROLE_LABELS[p.role]}</span></div>
              {p.current ? (
                <div className="tm-now">{p.current.emoji} <b>{p.current.label}</b> <small>{relDay(p.current.day)}{p.current.note ? ` · “${p.current.note}”` : ''}</small></div>
              ) : <div className="tm-now muted"><small>No mood shared today</small></div>}
              {p.history.length > 0 && (
                <div className="tm-hist">{p.history.slice(0, 4).map((h, i) => <span key={h.day} title={`${h.label}${h.note ? `: ${h.note}` : ''} · ${relDay(h.day)}`}>{h.emoji}<small>{i === 0 && p.current ? 'Previous' : relDay(h.day)}</small></span>)}</div>
              )}
            </div>
            {p.changes > 2 && <span className="tm-flag" title="Mood changed often this week">↕ {p.changes}</span>}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10 }}><TeamMoodPanel data={data} Avatar={Avatar} /></div>
    </div>
  );
}

// ---------- analytics (managers and the owner) ----------
function WorkAnalytics({ ctx, onMood }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { setData(null); api(`/work/analytics?team=${ctx.team.id}`).then(setData).catch(setErr); }, [ctx.team.id]);
  if (err) return <Empty icon="lock" title="Not available">{err.message}</Empty>;
  if (!data) return <Spinner />;
  const w = data.week;
  const tiles = [
    ['Active members', `${w.activeMembers}/${data.members}`, 'users'], ['Messages', w.messages, 'chat'], ['Posts', w.posts, 'cards'], ['Announcements', w.announcements, 'megaphone'],
    ['Shifts this week', w.shifts, 'clock'], ['Meetings this week', w.meetings, 'calendar'], ['People scheduled', `${w.scheduled}/${data.members}`, 'userCheck'], ['Open projects', data.projects.planning + data.projects.active + data.projects.on_hold, 'layers'],
  ];
  return (
    <div style={{ padding: '4px 16px 16px' }}>
      <div className="small muted" style={{ margin: '2px 2px 8px' }}>Last 7 days · only managers and the owner see this</div>
      <div className="an-tiles">{tiles.map(([l, v, i]) => <div key={l} className="an-tile"><small><Icon name={i} size={13} /> {l}</small><b>{v}</b></div>)}</div>
      <div className="an-card">
        <b>Team structure</b>
        <div className="an-roles">{data.roles.map((r) => <span key={r.role}><i className={`role-tag ${r.role}`}>{r.label}</i>{r.count}</span>)}</div>
      </div>
      <div className="an-card">
        <b>Most active members</b>
        {!data.mostActive.length ? <div className="wh-none">No team activity this week yet.</div> : data.mostActive.map((m, i) => (
          <div key={m.user.id} className="an-row"><span className="n">{i + 1}</span><Avatar user={m.user} size={30} /><span className="who"><b>{m.user.full_name}</b><small>{TEAM_ROLE_LABELS[m.role]}</small></span><small>{m.posts} posts · {m.messages} messages</small></div>
        ))}
      </div>
      <div className="an-card">
        <b>Most active channels</b>
        {data.activeChannels.map((c) => (
          <div key={c.id} className="an-row"><span className="hash">#</span><span className="who"><b>{c.name}</b></span><small>{c.messages} messages</small></div>
        ))}
      </div>
      <button className="an-card an-link" onClick={onMood}>
        <span><b>Team mood</b><small>{data.mood.week.top ? `Most common this week: ${data.mood.week.top.emoji} ${data.mood.week.top.label} · ${data.mood.week.participation}% took part` : 'No check-ins this week yet'}</small></span>
        <Icon name="next" size={18} />
      </button>
    </div>
  );
}
