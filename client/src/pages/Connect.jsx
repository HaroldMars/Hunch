import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import Icon from '@shared/Icon.jsx';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { Avatar, HeaderActions, Spinner, Empty, Confirm, timeAgo, useLoad } from '../components/ui.jsx';

export function FriendButton({ user: u, relation, onChange, compact }) {
  const { toast } = useApp();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const act = async (path, method = 'POST') => {
    setBusy(true);
    try {
      const r = await api(path, { method });
      onChange?.(r.relation);
      if (r.relation === 'friends') toast(`You and ${u.full_name.split(' ')[0]} are now friends`, 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const cls = `btn ${compact ? 'sm' : ''}`;
  if (relation === 'self') return null;
  if (relation === 'blocked') return <button className={`${cls} ghost`} disabled={busy} onClick={async () => { await api(`/users/${u.id}/block`, { method: 'DELETE' }); onChange?.('none'); }}>Unblock</button>;
  if (relation === 'friends') {
    return (
      <>
        <button className={`${cls}`} onClick={async () => {
          const c = await api('/conversations/direct', { method: 'POST', body: { userId: u.id } });
          nav(`/chats/${c.id}`);
        }}><Icon name="chat" size={17} /> Message</button>
        {!compact && <button className={`${cls} ghost`} onClick={() => setConfirm(true)} disabled={busy}><Icon name="userCheck" size={17} /> Friends</button>}
        {confirm && <Confirm title={`Remove ${u.full_name}?`} message="You'll no longer be able to message each other or see friends-only content." danger confirmLabel="Remove friend" onClose={() => setConfirm(false)} onConfirm={() => act(`/friends/${u.id}`, 'DELETE')} />}
      </>
    );
  }
  if (relation === 'incoming') {
    return (
      <>
        <button className={cls} disabled={busy} onClick={() => act(`/friends/${u.id}/accept`)}>Accept</button>
        <button className={`${cls} ghost`} disabled={busy} onClick={() => act(`/friends/${u.id}`, 'DELETE')}>Decline</button>
      </>
    );
  }
  if (relation === 'outgoing') return <button className={`${cls} ghost`} disabled={busy} onClick={() => act(`/friends/${u.id}`, 'DELETE')}>Requested · Cancel</button>;
  return <button className={cls} disabled={busy} onClick={() => act(`/friends/${u.id}/request`)}><Icon name="userPlus" size={17} /> Add friend</button>;
}

function PersonRow({ u, relation, sub, onChange }) {
  const nav = useNavigate();
  return (
    <div className="row-item">
      <Avatar user={u} size={46} onClick={() => nav(`/u/${u.id}`)} />
      <div className="meta" onClick={() => nav(`/u/${u.id}`)} style={{ cursor: 'pointer' }}>
        <div className="title">{u.full_name}</div>
        <div className="sub">{sub || u.job_title || (u.username ? `@${u.username}` : '')}</div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}><FriendButton user={u} relation={relation} onChange={onChange} compact /></div>
    </div>
  );
}

export default function Connect() {
  const nav = useNavigate();
  const [tab, setTab] = useState('requests');
  const req = useLoad(() => api('/friends/requests'), []);
  const sug = useLoad(() => api('/friends/suggestions'), []);
  const friends = useLoad(() => api('/friends'), []);
  const refresh = () => { req.reload(); sug.reload(); friends.reload(); };
  const incoming = req.data?.incoming || [];
  return (
    <div className="page flush">
      <div className="topbar">
        <h1>Connect</h1>
        <div className="spacer" />
        <button className="icon-btn" onClick={() => nav('/search')} aria-label="Search people"><Icon name="search" size={24} stroke={2.2} /></button>
        <HeaderActions />
      </div>
      <div className="tabs" role="tablist">
        <button className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>Requests{incoming.length ? ` (${incoming.length})` : ''}</button>
        <button className={tab === 'discover' ? 'active' : ''} onClick={() => setTab('discover')}>Discover</button>
        <button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}>Friends{friends.data ? ` (${friends.data.length})` : ''}</button>
      </div>
      <div style={{ padding: '8px 16px' }}>
        {tab === 'requests' && (req.loading ? <Spinner /> : (
          <>
            {!incoming.length && !req.data.outgoing.length && <Empty icon="userPlus" title="No pending requests">Find teammates in Discover or search by name or user ID.</Empty>}
            {incoming.length > 0 && <div className="section-title">Received</div>}
            {incoming.map((u) => <PersonRow key={u.id} u={u} relation="incoming" sub={`Sent ${timeAgo(u.requested_at)} ago`} onChange={refresh} />)}
            {req.data.outgoing.length > 0 && <div className="section-title">Sent</div>}
            {req.data.outgoing.map((u) => <PersonRow key={u.id} u={u} relation="outgoing" onChange={refresh} />)}
          </>
        ))}
        {tab === 'discover' && (sug.loading ? <Spinner /> : !sug.data.length ? <Empty icon="users" title="No suggestions">You're connected with everyone we know of.</Empty> : (
          <>
            <div className="section-title">People you may know</div>
            {sug.data.map((u) => (
              <PersonRow key={u.id} u={u} relation="none" onChange={refresh}
                sub={u.sameTeam ? 'On your team' : u.mutual ? `${u.mutual} mutual friend${u.mutual > 1 ? 's' : ''}` : undefined} />
            ))}
          </>
        ))}
        {tab === 'friends' && (friends.loading ? <Spinner /> : !friends.data.length ? <Empty icon="users" title="No friends yet">Send a friend request to start chatting.</Empty> :
          friends.data.map((u) => <PersonRow key={u.id} u={u} relation="friends" onChange={refresh} />))}
      </div>
    </div>
  );
}
