import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { api, toForm } from '../api.js';
import { useApp, useSocket } from '../store.jsx';
import { Avatar, TeamLogo, Sheet, Spinner, Empty, Lightbox, Confirm, TopBar, clockTime, useLoad } from '../components/ui.jsx';
import { ReportSheet } from './Profile.jsx';
import { SharedPost } from './ChatRoom.jsx';

const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function MediaSection({ cid }) {
  const [kind, setKind] = useState('photos');
  const { data, loading } = useLoad(() => api(`/conversations/${cid}/media?kind=${kind}`), [cid, kind]);
  const [img, setImg] = useState(null);
  return (
    <div className="settings-group">
      <div className="sg-title">Media</div>
      <div className="seg" style={{ marginBottom: 10 }}>
        {[['photos', 'Photos'], ['videos', 'Videos'], ['files', 'Files'], ['links', 'Links']].map(([k, l]) => (
          <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{l}</button>
        ))}
      </div>
      {loading ? <Spinner /> : !data.length ? <p className="small muted" style={{ margin: '6px 2px' }}>No {kind} shared yet.</p> : kind === 'photos' ? (
        <div className="media-grid">{data.map((x) => <img key={x.id} src={x.image} alt="" onClick={() => setImg(x.image)} />)}</div>
      ) : kind === 'videos' ? (
        <div className="media-grid">{data.map((x) => <video key={x.id} src={x.attachment.url} controls preload="metadata" />)}</div>
      ) : kind === 'files' ? data.map((x) => (
        <a key={x.id} className="file-row" href={x.attachment.url} download={x.attachment.name}>
          <span className="ficon"><Icon name="file" size={20} /></span>
          <span className="meta"><b>{x.attachment.name}</b><small>{fmtSize(x.attachment.size)} · {x.sender} · {new Date(x.created_at).toLocaleDateString()}</small></span>
          <Icon name="download" size={18} />
        </a>
      )) : data.map((x, i) => (
        <a key={`${x.id}-${i}`} className="file-row" href={x.url} target="_blank" rel="noreferrer noopener">
          <span className="ficon"><Icon name="link" size={20} /></span>
          <span className="meta"><b>{x.url.replace(/^https?:\/\//, '')}</b><small>{x.sender} · {new Date(x.created_at).toLocaleDateString()}</small></span>
        </a>
      ))}
      <Lightbox src={img} onClose={() => setImg(null)} />
    </div>
  );
}

function Row({ icon, label, sub, onClick, danger, right }) {
  return (
    <button className={`sg-row ${danger ? 'danger' : ''}`} onClick={onClick}>
      <Icon name={icon} size={21} />
      <span className="sg-label">{label}{sub && <small>{sub}</small>}</span>
      {right ?? <Icon name="next" size={17} className="chev" />}
    </button>
  );
}

function SearchSheet({ cid, onClose }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  useEffect(() => { const t = setTimeout(() => api(`/conversations/${cid}/search?q=${encodeURIComponent(q)}`).then(setRes), 200); return () => clearTimeout(t); }, [q, cid]);
  return (
    <Sheet title="Search in conversation" onClose={onClose}>
      <div className="search-bar" style={{ height: 40 }}><Icon name="search" size={18} /><input autoFocus placeholder="Search messages" value={q} onChange={(e) => setQ(e.target.value)} style={{ fontSize: 14 }} /></div>
      <div style={{ marginTop: 8 }}>
        {q && !res.length && <p className="muted small">No messages match “{q}”.</p>}
        {res.map((m) => (
          <div key={m.id} className="row-item" style={{ alignItems: 'flex-start' }}>
            <Avatar user={m.sender} size={32} />
            <div className="meta"><div className="title" style={{ fontSize: 13 }}>{m.sender?.full_name} <span className="muted small" style={{ fontWeight: 500 }}>{new Date(m.created_at).toLocaleDateString()} {clockTime(m.created_at)}</span></div>
              <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{m.text}</div></div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function AddMembers({ conv, onClose, onDone }) {
  const { toast } = useApp();
  const friends = useLoad(() => api('/friends'), []);
  const [picked, setPicked] = useState([]);
  const list = (friends.data || []).filter((f) => !conv.members.some((m) => m.id === f.id));
  return (
    <Sheet title="Add members" onClose={onClose}
      footer={<button className="btn block" disabled={!picked.length} onClick={async () => {
        try { await api(`/conversations/${conv.id}/members`, { method: 'POST', body: { userIds: picked } }); toast('Members added', 'success'); onDone(); onClose(); } catch (e) { toast(e.message, 'error'); }
      }}>Add {picked.length || ''}</button>}>
      {friends.loading ? <Spinner /> : !list.length ? <Empty icon="users" title="Everyone's here">All your friends are already in this group.</Empty> : list.map((f) => (
        <div key={f.id} className={`check-row ${picked.includes(f.id) ? 'on' : ''}`} onClick={() => setPicked(picked.includes(f.id) ? picked.filter((x) => x !== f.id) : [...picked, f.id])}>
          <Avatar user={f} size={38} /><div style={{ flex: 1, fontWeight: 600 }}>{f.full_name}</div><span className="box"><Icon name="check" size={14} /></span>
        </div>
      ))}
    </Sheet>
  );
}

export default function ChatInfo() {
  const { id } = useParams();
  const cid = Number(id);
  const nav = useNavigate();
  const { user, toast } = useApp();
  const { data: conv, reload, error } = useLoad(() => api(`/conversations/${cid}`), [cid]);
  const [sheet, setSheet] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [edit, setEdit] = useState(null);
  const photoRef = useRef();
  useSocket('conversation:update', ({ id: x }) => x === cid && reload());

  if (error) return <div className="page"><TopBar title="Chat" back /><Empty icon="lock" title="Unavailable">{error.message}</Empty></div>;
  if (!conv) return <div className="page"><Spinner /></div>;
  const group = conv.type === 'group';
  const admin = conv.my_role === 'admin';
  // Team channels: membership follows the team (managed in Work), so add / remove / leave live there.
  const team = conv.team || null;
  const manageMembers = admin && !team;
  const run = async (fn, msg) => { try { await fn(); if (msg) toast(msg, 'success'); reload(); } catch (e) { toast(e.message, 'error'); } };
  const status = team ? `${team.name} · ${conv.members.length} members` : group ? `${conv.members.length} members` : conv.blocked ? 'Blocked' : conv.other?.online ? 'Active now' : conv.other?.job_title || 'Friend';

  return (
    <div className="page flush">
      <TopBar title="" back />
      <div className="chat-profile">
        <div className="avatar-wrap">
          {team ? <TeamLogo team={team} size={96} /> : <Avatar src={conv.avatar} size={96} online={!group && conv.other?.online} />}
          {group && admin && !team && <button className="cp-cam" onClick={() => photoRef.current.click()} aria-label="Change group photo"><Icon name="camera" size={16} /></button>}
        </div>
        <h2>{team ? `#${conv.title}` : conv.title}</h2>
        <div className="muted small">{status}{conv.streak >= 2 ? ` · 🔥 ${conv.streak}-day streak` : ''}</div>
        {group && conv.description && <p className="cp-desc">{conv.description}</p>}
        {group && admin && <button className="link-btn small" style={{ marginTop: 6 }} onClick={() => setEdit({ name: conv.name, description: conv.description || '' })}>Change name, description and image</button>}
        <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && run(() => api(`/conversations/${cid}/photo`, { method: 'POST', form: toForm({ photo: e.target.files[0] }) }), 'Group photo updated')} />
        <div className="cp-actions">
          {team ? (
            <button onClick={() => nav('/?tab=work')}><span><Icon name="briefcase" size={22} /></span>Team</button>
          ) : group ? (
            <button onClick={() => (admin ? setSheet('add') : toast('Only group admins can add members'))}><span><Icon name="userPlus" size={22} /></span>Add</button>
          ) : (
            <button onClick={() => nav(`/u/${conv.other.id}`)}><span><Icon name="user" size={22} /></span>Profile</button>
          )}
          <button onClick={() => setSheet('search')}><span><Icon name="search" size={22} /></span>Search</button>
          <button onClick={() => run(() => api(`/conversations/${cid}/mute`, { method: 'POST' }), conv.muted ? 'Unmuted' : 'Muted')}>
            <span><Icon name={conv.muted ? 'bell' : 'bellOff'} size={22} /></span>{conv.muted ? 'Unmute' : 'Mute'}</button>
          <button onClick={() => setSheet('options')}><span><Icon name="more" size={22} /></span>Options</button>
        </div>
      </div>

      <div style={{ padding: '0 16px 40px' }}>
        <MediaSection cid={cid} />

        {group && (
          <div className="settings-group">
            <div className="sg-title" style={{ display: 'flex' }}>Members · {conv.members.length}<span style={{ flex: 1 }} />{manageMembers && <button className="link-btn small" onClick={() => setSheet('add')}>+ Add members</button>}</div>
            {conv.members.map((m) => (
              <div key={m.id} className="row-item">
                <Avatar user={m} size={40} online={m.online} onClick={() => nav(`/u/${m.id}`)} />
                <div className="meta"><div className="title">{m.full_name}{m.id === user.id ? ' (you)' : ''}</div><div className="sub">{m.member_role === 'admin' ? (team ? 'Team admin' : 'Group admin') : 'Member'}</div></div>
                {manageMembers && m.id !== user.id && (
                  <button className="icon-btn" aria-label={`Manage ${m.full_name}`} onClick={() => setSheet({ member: m })}><Icon name="more" size={18} /></button>
                )}
              </div>
            ))}
          </div>
        )}

        {group && (
          <div className="settings-group">
            <div className="sg-title">{team ? 'Channel settings' : 'Group settings'}</div>
            <Row icon="edit" label="Group name" sub={conv.name} onClick={() => (admin ? setEdit({ name: conv.name, description: conv.description || '' }) : toast('Only group admins can change group settings'))} />
            <Row icon="note" label="Group description" sub={conv.description || 'No description'} onClick={() => (admin ? setEdit({ name: conv.name, description: conv.description || '' }) : toast('Only group admins can change group settings'))} />
            {!team && <Row icon="camera" label="Group photo" sub={admin ? 'Change the group photo' : 'Only admins can change this'} onClick={() => admin && photoRef.current.click()} />}
          </div>
        )}

        <div className="settings-group">
          <div className="sg-title">Message management</div>
          <Row icon="pin" label="Pinned messages" onClick={() => setSheet('pinned')} />
          <Row icon="share" label="Shared content" sub="Posts shared in this chat" onClick={() => setSheet('shared')} />
        </div>

        <div className="settings-group">
          <div className="sg-title">Chat options</div>
          <Row icon={conv.muted ? 'bell' : 'bellOff'} label={conv.muted ? 'Unmute chat' : 'Mute chat'} sub={conv.muted ? 'You won’t get notifications from this chat' : null}
            onClick={() => run(() => api(`/conversations/${cid}/mute`, { method: 'POST' }), conv.muted ? 'Unmuted' : 'Muted')} />
          <Row icon="inbox" label={conv.archived ? 'Unarchive chat' : 'Archive chat'} onClick={() => run(() => api(`/conversations/${cid}/archive`, { method: 'POST' }), conv.archived ? 'Moved back to Chats' : 'Chat archived')} />
          {!group && (conv.blocked
            ? <Row icon="userCheck" label={`Unblock ${conv.other.full_name.split(' ')[0]}`} onClick={() => run(() => api(`/users/${conv.other.id}/block`, { method: 'DELETE' }), 'Unblocked')} />
            : <Row icon="userMinus" label={`Block ${conv.other.full_name.split(' ')[0]}`} danger onClick={() => setConfirm('block')} />)}
          <Row icon="shield" label={group ? 'Report group' : `Report ${conv.other.full_name.split(' ')[0]}`} danger onClick={() => setSheet('report')} />
          {group && !team && <Row icon="logout" label="Leave group" danger onClick={() => setConfirm('leave')} />}
          {team && <div className="small muted" style={{ padding: '8px 2px' }}>Everyone in {team.name} is in this channel. To leave it, leave the team in Work.</div>}
        </div>
      </div>

      {sheet === 'options' && (
        <Sheet title="" onClose={() => setSheet(null)}>
          <div className="menu-list">
            <button onClick={() => { setSheet(null); run(() => api(`/conversations/${cid}/archive`, { method: 'POST' }), conv.archived ? 'Moved back to Chats' : 'Chat archived'); }}><Icon name="inbox" /> {conv.archived ? 'Unarchive chat' : 'Archive chat'}</button>
            <button onClick={() => setSheet('report')}><Icon name="shield" /> Report</button>
            {!group && !conv.blocked && <button className="danger" onClick={() => { setSheet(null); setConfirm('block'); }}><Icon name="userMinus" /> Block</button>}
            {group && !team && <button className="danger" onClick={() => { setSheet(null); setConfirm('leave'); }}><Icon name="logout" /> Leave group</button>}
          </div>
        </Sheet>
      )}
      {sheet === 'search' && <SearchSheet cid={cid} onClose={() => setSheet(null)} />}
      {sheet === 'add' && <AddMembers conv={conv} onClose={() => setSheet(null)} onDone={reload} />}
      {sheet === 'report' && <ReportSheet target={group ? 'conversation' : 'user'} id={group ? cid : conv.other.id} name={conv.title} onClose={() => setSheet(null)} />}
      {sheet === 'pinned' && <ListSheet title="Pinned messages" url={`/conversations/${cid}/pinned`} empty="Nothing pinned yet. Tap a message and choose Pin." onClose={() => setSheet(null)} />}
      {sheet === 'shared' && <ListSheet title="Shared content" url={`/conversations/${cid}/shared`} empty="No posts have been shared here yet." onClose={() => setSheet(null)} shared />}
      {sheet?.member && (
        <Sheet title={sheet.member.full_name} onClose={() => setSheet(null)}>
          <div className="menu-list">
            <button onClick={() => { setSheet(null); nav(`/u/${sheet.member.id}`); }}><Icon name="user" /> View profile</button>
            <button onClick={() => { const m = sheet.member; setSheet(null); run(() => api(`/conversations/${cid}/admins/${m.id}`, { method: 'POST' }), 'Updated'); }}><Icon name="shield" /> {sheet.member.member_role === 'admin' ? 'Dismiss as admin' : 'Make group admin'}</button>
            <button className="danger" onClick={() => { const m = sheet.member; setSheet(null); setConfirm({ remove: m }); }}><Icon name="userMinus" /> Remove from group</button>
          </div>
        </Sheet>
      )}
      {edit && (
        <Sheet title="Group details" onClose={() => setEdit(null)}
          footer={<button className="btn block" disabled={!edit.name.trim()} onClick={() => { const e = edit; setEdit(null); run(() => api(`/conversations/${cid}`, { method: 'PATCH', body: e }), 'Group updated'); }}>Save</button>}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar src={conv.avatar} size={56} /><button className="btn ghost sm" onClick={() => photoRef.current.click()}><Icon name="camera" size={15} /> Change photo</button>
          </div>
          <label className="label">Group name</label>
          <input className="input" value={edit.name} maxLength={60} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <label className="label">Description</label>
          <textarea className="input" value={edit.description} maxLength={300} placeholder="What's this group about?" onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
        </Sheet>
      )}
      {confirm === 'block' && <Confirm title={`Block ${conv.other.full_name}?`} danger confirmLabel="Block" onClose={() => setConfirm(null)}
        message="You won't be able to message each other, and you'll be removed as friends. They won't be notified."
        onConfirm={async () => { await api(`/users/${conv.other.id}/block`, { method: 'POST' }); toast('Blocked'); reload(); }} />}
      {confirm === 'leave' && <Confirm title="Leave group?" danger confirmLabel="Leave" onClose={() => setConfirm(null)} message="You'll stop receiving messages from this group."
        onConfirm={async () => { await api(`/conversations/${cid}/members/${user.id}`, { method: 'DELETE' }); nav('/chats'); }} />}
      {confirm?.remove && <Confirm title={`Remove ${confirm.remove.full_name}?`} danger confirmLabel="Remove" onClose={() => setConfirm(null)} message="Members are notified in the chat."
        onConfirm={async () => { await api(`/conversations/${cid}/members/${confirm.remove.id}`, { method: 'DELETE' }); reload(); }} />}
    </div>
  );
}

function ListSheet({ title, url, empty, onClose, shared }) {
  const { data, loading } = useLoad(() => api(url), [url]);
  return (
    <Sheet title={title} onClose={onClose}>
      {loading ? <Spinner /> : !data.length ? <p className="muted">{empty}</p> : data.map((m) => (
        <div key={m.id} className="row-item" style={{ alignItems: 'flex-start' }}>
          <Avatar user={m.sender} size={32} />
          <div className="meta">
            <div className="title" style={{ fontSize: 13 }}>{m.sender?.full_name} <span className="muted small" style={{ fontWeight: 500 }}>{new Date(m.created_at).toLocaleDateString()}</span></div>
            {shared && m.shared_post ? <SharedPost p={m.shared_post} /> : <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{m.text || (m.image ? '📷 Photo' : m.attachment ? `📎 ${m.attachment.name}` : '')}</div>}
          </div>
        </div>
      ))}
    </Sheet>
  );
}
