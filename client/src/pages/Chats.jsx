import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { api, toForm } from '../api.js';
import { useApp, useSocket } from '../store.jsx';
import { Avatar, HeaderActions, Sheet, Spinner, Empty, TeamLogo, listTime, timeAgo, useLoad, FilePreviews } from '../components/ui.jsx';

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

export default function Chats() {
  const { user, refreshUnread } = useApp();
  const nav = useNavigate();
  const [convs, setConvs] = useState(null);
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState(null);
  const [archived, setArchived] = useState(false);
  // Work Mode splits Chats into Personal (friends, groups) and Teams (team channels).
  const [scope, setScope] = useState('personal');
  const teams = !!user.work_mode && scope === 'teams' && !archived;
  const load = () => api(`/conversations${teams ? '?scope=teams' : archived ? '?archived=1' : ''}`).then(setConvs);
  useEffect(() => { setConvs(null); load(); refreshUnread(); }, [archived, teams]);
  useSocket('message:new', load);
  useSocket('conversation:update', load);
  useSocket('message:read', load);

  const filtered = useMemo(() => (convs || []).filter((c) => `${c.title} ${c.team?.name || ''}`.toLowerCase().includes(q.toLowerCase())), [convs, q]);

  return (
    <div className="page flush">
      <div className="topbar">
        {archived ? <><button className="icon-btn" onClick={() => setArchived(false)} aria-label="Back to chats"><Icon name="back" /></button><h2>Archived chats</h2></> : <h1>Chats</h1>}
        <div className="spacer" />
        {!archived && !teams && <button className="icon-btn" onClick={() => setArchived(true)} aria-label="Archived chats" title="Archived chats"><Icon name="inbox" size={23} /></button>}
        {!teams && <button className="icon-btn" onClick={() => setSheet({ type: 'new' })} aria-label="New message"><Icon name="edit" size={23} /></button>}
        <HeaderActions />
      </div>
      {user.work_mode && !archived && (
        <div className="tabs chat-scope" role="tablist">
          {[['personal', 'Personal'], ['teams', 'Teams']].map(([k, l]) => <button key={k} role="tab" aria-selected={scope === k} className={scope === k ? 'active' : ''} onClick={() => setScope(k)}>{l}</button>)}
        </div>
      )}
      <div style={{ padding: '4px 16px 0' }}>
        <div className="search-bar"><Icon name="search" size={20} stroke={2.2} /><input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" /></div>
      </div>
      <div style={{ padding: '4px 16px' }}>
        {convs === null ? <Spinner /> : !filtered.length ? (
          teams ? <Empty icon="briefcase" title={q ? 'No channels match' : 'No team chats yet'}>{q ? 'Try another name.' : <>Team channels appear here once you create or join a team. <button className="link-btn" onClick={() => nav('/?tab=work')}>Open Work</button></>}</Empty> : archived ? <Empty icon="inbox" title="No archived chats">Archive a chat from its profile page to tidy your list.</Empty> : <Empty icon="chat" title={q ? 'No chats match' : 'No conversations yet'}>
            {q ? 'Try another name.' : <>Start chatting with a friend. <button className="link-btn" onClick={() => setSheet({ type: 'new' })}>New message</button></>}
          </Empty>
        ) : filtered.map((c) => {
          const lm = c.last_message;
          const prefix = lm && lm.kind !== 'system' && lm.sender_id === user.id ? 'You: ' : c.type === 'group' && lm?.sender_name && lm.kind !== 'system' ? `${lm.sender_name}: ` : '';
          return (
            <button key={c.id} className="row-item" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left' }} onClick={() => nav(`/chats/${c.id}`)}>
              {c.team ? <TeamLogo team={c.team} size={50} /> : <Avatar src={c.avatar} size={50} online={c.type === 'direct' && c.other?.online} />}
              <div className="meta">
                {c.team && <div className="chat-team">{c.team.name}</div>}
                <div className="title">{c.team ? <span className="hash">#</span> : c.type === 'group' && <Icon name="users" size={15} />}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</span> <Streak n={c.streak} />{c.muted && <Icon name="bellOff" size={14} style={{ color: 'var(--text-3)' }} />}</div>
                <div className={`sub ${c.unread ? 'unread' : ''}`}>
                  {c.unread > 1 ? `${c.unread} new messages` : lm ? prefix + lm.text : 'Say hi 👋'}
                </div>
              </div>
              <div className="right">
                {lm && <span>{listTime(lm.created_at)}</span>}
                {c.unread > 0 && <span className="pill-count">{c.unread > 99 ? '99+' : c.unread}</span>}
              </div>
            </button>
          );
        })}
      </div>
      {sheet?.type === 'new' && <NewChatSheet onClose={() => setSheet(null)} />}
    </div>
  );
}
