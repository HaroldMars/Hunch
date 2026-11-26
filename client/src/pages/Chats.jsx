import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { api, toForm } from '../api.js';
import { useApp, useSocket } from '../store.jsx';
import { Avatar, HeaderActions, Sheet, Spinner, Empty, TeamLogo, WorkMood, listTime, useLoad, FilePreviews } from '../components/ui.jsx';
import { StoryViewer } from '../components/Stories.jsx';

export function Streak({ n }) {
  if (!n || n < 2) return null;
  return <span className="streak" title={`${n}-day chat streak`}>🔥{n}</span>;
}

function NewChatSheet({ onClose }) {
  const { toast } = useApp();
  const nav = useNavigate();
  const friends = useLoad(() => api('/friends'), []);
  const [mode, setMode] = useState('direct');
  const [picked, setPicked] = useState([]);
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState(null);
  const [q, setQ] = useState('');
  const list = (friends.data || []).filter((f) => f.full_name.toLowerCase().includes(q.toLowerCase()));
  const openDirect = async (f) => {
    try {
      const c = await api('/conversations/direct', { method: 'POST', body: { userId: f.id } });
      nav(`/chats/${c.id}`);
    } catch (e) { toast(e.message, 'error'); }
  };
  const createGroup = async () => {
    try {
      const c = await api('/conversations/group', { method: 'POST', body: { name, memberIds: picked } });
      if (photo) await api(`/conversations/${c.id}/photo`, { method: 'POST', form: toForm({ photo }) });
      nav(`/chats/${c.id}`);
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Sheet title="New message" onClose={onClose}
      footer={mode === 'group' && <button className="btn block" disabled={!name.trim() || !picked.length} onClick={createGroup}>Create group ({picked.length})</button>}>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={mode === 'direct' ? 'active' : ''} onClick={() => setMode('direct')}><Icon name="user" size={16} /> Private</button>
        <button className={mode === 'group' ? 'active' : ''} onClick={() => setMode('group')}><Icon name="users" size={16} /> Group</button>
      </div>
      {mode === 'group' && (
        <>
          <input className="input" placeholder="Group name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <label className="btn ghost sm" style={{ marginTop: 8 }}><Icon name="camera" size={16} /> {photo ? 'Change group photo' : 'Add group photo'}
            <input type="file" accept="image/*" hidden onChange={(e) => setPhoto(e.target.files[0] || null)} /></label>
          {photo && <FilePreviews files={[photo]} onRemove={() => setPhoto(null)} />}
        </>
      )}
      <div className="search-bar" style={{ margin: '12px 0 6px', height: 38 }}><Icon name="search" size={18} /><input placeholder="Search friends" value={q} onChange={(e) => setQ(e.target.value)} style={{ fontSize: 14 }} /></div>
      {friends.loading ? <Spinner /> : !list.length ? <Empty icon="userPlus" title="No friends found">Messaging becomes available after a friend request is accepted.</Empty> : list.map((f) => (
        mode === 'direct' ? (
          <button key={f.id} className="row-item" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left' }} onClick={() => openDirect(f)}>
            <Avatar user={f} size={42} /><div className="meta"><div className="title">{f.full_name}</div><div className="sub">{f.job_title}</div></div>
          </button>
        ) : (
          <div key={f.id} className={`check-row ${picked.includes(f.id) ? 'on' : ''}`} onClick={() => setPicked(picked.includes(f.id) ? picked.filter((x) => x !== f.id) : [...picked, f.id])}>
            <Avatar user={f} size={40} /><div style={{ flex: 1, fontWeight: 600 }}>{f.full_name}</div><span className="box"><Icon name="check" size={14} /></span>
          </div>
        )
      ))}
    </Sheet>
  );
}

const timeShort = (d) => {
  const s = (Date.now() - new Date(d)) / 1000;
  return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : listTime(d);
};

function ChatRow({ c, me, onOpen, story, onStory }) {
  const lm = c.last_message;
  const prefix = lm && lm.kind !== 'system' && lm.sender_id === me ? 'You: ' : c.type === 'group' && lm?.sender_name && lm.kind !== 'system' ? `${lm.sender_name}: ` : '';
  return (
    <button className={`chat-row ${c.unread ? 'unread' : ''}`} onClick={onOpen}>
      {c.team ? <span className="cr-chan"><span className="hash">#</span></span>
        : <Avatar src={c.avatar} size={56} online={c.type === 'direct' && c.other?.online} story={story}
          onClick={story ? (e) => { e.stopPropagation(); onStory(); } : undefined} />}
      <div className="cr-main">
        <div className="cr-top">
          <span className="cr-name">{c.type === 'group' && !c.team && <Icon name="users" size={14} />}{c.title}</span>
          <span className="cr-time">{lm ? timeShort(lm.created_at) : ''}</span>
        </div>
        <div className="cr-bottom">
          <span className="cr-last">{c.unread > 1 ? `${c.unread} new messages` : lm ? prefix + lm.text : 'Say hi 👋'}</span>
          <span className="cr-badges">
            <Streak n={c.streak} /><WorkMood mood={c.work_mood} />
            {c.muted && <Icon name="bellOff" size={14} style={{ color: 'var(--text-3)' }} />}
            {c.unread > 0 && <span className="pill-count">{c.unread > 99 ? '99+' : c.unread}</span>}
          </span>
        </div>
      </div>
    </button>
  );
}

export default function Chats() {
  const { user, refreshUnread } = useApp();
  const nav = useNavigate();
  const [convs, setConvs] = useState(null);
  const [teamConvs, setTeamConvs] = useState([]);
  const [teams, setTeams] = useState([]);
  const [stories, setStories] = useState([]); // friends' active stories: a ring on their avatar opens them
  const [viewer, setViewer] = useState(null);
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState(null);
  const [archived, setArchived] = useState(false);
  const [filter, setFilter] = useState('all'); // all | personal | groups | teams
  const work = !!user.work_mode;
  const load = () => {
    api(`/conversations${archived ? '?archived=1' : ''}`).then(setConvs);
    if (work && !archived) {
      api('/conversations?scope=teams').then(setTeamConvs).catch(() => setTeamConvs([]));
      api('/work/chat-teams').then(setTeams).catch(() => setTeams([]));
    }
  };
  const loadStories = () => api('/stories').then((g) => setStories((g || []).filter((x) => x.user.id !== user.id && x.stories.length))).catch(() => setStories([]));
  useEffect(() => { setConvs(null); load(); refreshUnread(); }, [archived]);
  useEffect(() => { loadStories(); }, []);
  const storyIndex = (c) => (c.type === 'direct' && c.other ? stories.findIndex((g) => g.user.id === c.other.id) : -1);
  const rowStory = (c) => {
    const i = storyIndex(c);
    return i < 0 ? {} : { story: stories[i].allSeen ? 'seen' : 'new', onStory: () => setViewer(i) };
  };
  useSocket('message:new', load);
  useSocket('conversation:update', load);
  useSocket('message:read', load);
  useSocket('mood:update', load);

  const match = (c) => `${c.title} ${c.team?.name || ''}`.toLowerCase().includes(q.toLowerCase());
  const shown = useMemo(() => (convs || []).filter(match).filter((c) => (filter === 'personal' ? c.type === 'direct' : filter === 'groups' ? c.type === 'group' : true)), [convs, q, filter]);
  const teamGroups = useMemo(() => teams.map((t) => ({ ...t, channels: teamConvs.filter((c) => c.team?.id === t.id && match(c)) })).filter((t) => t.channels.length || t.name.toLowerCase().includes(q.toLowerCase())), [teams, teamConvs, q]);
  const unreadOf = (list) => list.reduce((n, c) => n + (c.unread || 0), 0);
  const chips = [['all', 'All'], ['personal', 'Personal'], ['groups', 'Groups'], ...(work ? [['teams', 'Teams']] : [])];

  return (
    <div className="page flush chats-v2">
      <div className="topbar">
        {archived ? <><button className="icon-btn" onClick={() => setArchived(false)} aria-label="Back to chats"><Icon name="back" /></button><h2>Archived chats</h2></> : <h1>Chats</h1>}
        <div className="spacer" />
        {!archived && <button className="icon-btn" onClick={() => setArchived(true)} aria-label="Archived chats" title="Archived chats"><Icon name="inbox" size={23} /></button>}
        <button className="icon-btn" onClick={() => setSheet({ type: 'new' })} aria-label="New message"><Icon name="edit" size={23} /></button>
        <HeaderActions />
      </div>
      <div style={{ padding: '4px 16px 0' }}>
        <div className="search-bar glass"><Icon name="search" size={20} stroke={2.2} /><input placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" /></div>
      </div>
      {!archived && (
        <div className="chat-chips" role="tablist">
          {chips.map(([k, l]) => {
            const n = k === 'teams' ? unreadOf(teamConvs) : k === 'personal' ? unreadOf((convs || []).filter((c) => c.type === 'direct')) : k === 'groups' ? unreadOf((convs || []).filter((c) => c.type === 'group')) : 0;
            return <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}{n > 0 && <i>{n > 99 ? '99+' : n}</i>}</button>;
          })}
        </div>
      )}
      <div className="chat-list">
        {filter === 'teams' ? (
          !teamGroups.length ? <Empty icon="briefcase" title={q ? 'No teams match' : 'No team chats yet'}>{q ? 'Try another name.' : <>Team channels appear here once you create or join a team. <button className="link-btn" onClick={() => nav('/?tab=work')}>Open Work</button></>}</Empty>
            : teamGroups.map((t) => (
              <div key={t.id} className="team-card">
                <button className="tc-head" onClick={() => nav('/?tab=work')}>
                  <TeamLogo team={t} size={48} />
                  <span className="tc-meta">
                    <b>{t.name}</b>
                    <small>{t.members} member{t.members === 1 ? '' : 's'}{t.streak >= 2 ? <> · <span className="streak">🔥{t.streak}</span> team streak</> : ''}</small>
                  </span>
                  {t.mood && <span className="tc-mood" title="Most common mood on the team right now">{t.mood.emoji} {t.mood.label}<small>{t.mood.pct}%</small></span>}
                </button>
                {t.channels.map((c) => <ChatRow key={c.id} c={c} me={user.id} onOpen={() => nav(`/chats/${c.id}`)} {...rowStory(c)} />)}
              </div>
            ))
        ) : convs === null ? <Spinner /> : !shown.length ? (
          archived ? <Empty icon="inbox" title="No archived chats">Archive a chat from its profile page to tidy your list.</Empty>
            : <Empty icon="chat" title={q ? 'No chats match' : filter === 'groups' ? 'No group chats yet' : 'No conversations yet'}>{q ? 'Try another name.' : <>Start chatting with a friend. <button className="link-btn" onClick={() => setSheet({ type: 'new' })}>New message</button></>}</Empty>
        ) : shown.map((c) => <ChatRow key={c.id} c={c} me={user.id} onOpen={() => nav(`/chats/${c.id}`)} {...rowStory(c)} />)}
      </div>
      {sheet?.type === 'new' && <NewChatSheet onClose={() => setSheet(null)} />}
      {viewer !== null && <StoryViewer groups={stories} startGroup={viewer} onClose={() => { setViewer(null); loadStories(); }} onChanged={loadStories} />}
    </div>
  );
}
