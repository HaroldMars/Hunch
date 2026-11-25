import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { api, toForm } from '../api.js';
import { useApp, useSocket } from '../store.jsx';
import { moodByKey, themeCss } from '@shared/constants.js';
import { Avatar, TeamLogo, Sheet, Spinner, Empty, Lightbox, clockTime, useLoad, FilePreviews } from '../components/ui.jsx';
import { Streak } from './Chats.jsx';

const EMOJIS = '😀 😂 🥹 😊 😍 🥰 😘 😎 🤩 🥳 😇 🙂 😉 😌 😴 🤔 🧐 😮 😢 😭 😤 😠 🤯 😱 🙄 😬 🤗 🤭 👍 👎 👏 🙌 🙏 💪 👋 🤝 ❤️ 🧡 💛 💚 💙 💜 🖤 💯 🔥 ✨ 🎉 🎂 ☕ 🍕 🌞 🌙 ⭐ 🌈 ✅ ❌ 👀 💬'.split(' ');
const QUICK = ['❤️', '😂', '😮', '😢', '😡', '👍'];

const dayLabel = (iso) => {
  const d = new Date(iso);
  const t = new Date();
  if (d.toDateString() === t.toDateString()) return 'Today';
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

/** Shared post card: photo, caption, "Posted by", tap to open the full post. */
export function SharedPost({ p }) {
  if (!p || p.unavailable) return <div className="shared-post unavailable"><Icon name="lock" size={16} /> This post is unavailable</div>;
  return (
    <Link to={`/post/${p.id}`} className="shared-post" onClick={(e) => e.stopPropagation()}>
      {p.images?.[0] && <img src={p.images[0]} alt="" />}
      {p.text && <div className="sp-caption">{p.text}</div>}
      <div className="sp-by"><Avatar user={p.author} size={18} /> Posted by <b>{p.author.full_name}</b></div>
      <div className="sp-cta">Tap to view full post <Icon name="next" size={13} /></div>
    </Link>
  );
}

/** Shared highlight card: cover circle, title, owner; opens the highlight on their profile. */
function SharedHighlight({ h }) {
  if (!h || h.unavailable) return <div className="shared-post unavailable small muted">Highlight unavailable</div>;
  return (
    <Link to={`/u/${h.owner.id}?highlight=${h.id}`} className="shared-hl" onClick={(e) => e.stopPropagation()}>
      <div className="sh-cover" style={{ background: h.cover ? '#000' : themeCss(h.theme) }}>{h.cover ? <img src={h.cover} alt="" /> : <span>{h.cover_emoji || moodByKey(h.mood)?.emoji || '✨'}</span>}</div>
      <div className="sh-meta"><small>Highlight</small><b>{h.title}</b><span>{h.owner.full_name} · {h.count} {h.count === 1 ? 'story' : 'stories'}</span></div>
      <Icon name="next" size={16} />
    </Link>
  );
}

/** "Replied to your note" — a small quoted bubble above the reply. */
function NoteRef({ n, mine, other }) {
  return (
    <div className="note-ref">
      <span className="small muted">{mine ? `You replied to ${other}'s note` : 'Replied to your note'}</span>
      <span className={`nr-bubble ${n.color ? 'tinted' : ''}`} style={n.color ? { background: n.color, color: parseInt(n.color.slice(1), 16) > 0xaaaaaa ? '#111' : '#fff' } : undefined}>{n.emoji ? `${n.emoji} ` : ''}{n.text}</span>
    </div>
  );
}

/** "Replied to your story" preview shown above a story reply. */
function StoryRef({ s, mine, other }) {
  if (!s || s.unavailable) return <div className="story-ref unavailable">Story unavailable</div>;
  const m = moodByKey(s.mood);
  return (
    <div className="story-ref">
      <span className="small muted">{mine ? `You replied to ${other}'s story` : 'Replied to your story'}</span>
      <div className="sr-thumb" style={{ background: s.image ? '#000' : themeCss(s.theme) }}>
        {s.image ? <img src={s.image} alt="" /> : <span>{m?.emoji} {s.text}</span>}
        {s.expired && <em>Expired</em>}
      </div>
    </div>
  );
}

const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
function Attachment({ a }) {
  if (a.type.startsWith('video/')) return <video className="msg-video" src={a.url} controls preload="metadata" />;
  return (
    <a className="file-chip" href={a.url} download={a.name} onClick={(e) => e.stopPropagation()}>
      <span className="ficon"><Icon name="file" size={20} /></span>
      <span className="meta"><b>{a.name}</b><small>{fmtSize(a.size)}</small></span>
      <Icon name="download" size={18} />
    </a>
  );
}

export default function ChatRoom() {
  const { id } = useParams();
  const cid = Number(id);
  const nav = useNavigate();
  const { user, toast, emit, refreshUnread } = useApp();
  const [conv, setConv] = useState(null);
  const [messages, setMessages] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [typing, setTyping] = useState({});
  const [action, setAction] = useState(null);
  const [panel, setPanel] = useState(null);
  const [img, setImg] = useState(null);
  const [error, setError] = useState(null);
  const listRef = useRef();
  const fileRef = useRef();
  const typingTimer = useRef();
  const stick = useRef(true);

  const loadConv = () => api(`/conversations/${cid}`).then(setConv).catch((e) => setError(e.message));
  const markRead = () => api(`/conversations/${cid}/read`, { method: 'POST' }).then(refreshUnread).catch(() => {});
  useEffect(() => {
    setMessages(null);
    loadConv();
    api(`/conversations/${cid}/messages`).then((r) => { setMessages(r.messages); setHasMore(r.hasMore); markRead(); }).catch((e) => setError(e.message));
  }, [cid]);

  useEffect(() => {
    if (stick.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, typing]);

  useSocket('message:new', ({ conversationId, message }) => {
    if (conversationId !== cid) return;
    setMessages((m) => (m && !m.some((x) => x.id === message.id) ? [...m, message] : m));
    if (message.sender_id !== user.id) markRead();
    if (message.kind === 'system') loadConv();
    setTyping((t) => ({ ...t, [message.sender_id]: undefined }));
  });
  useSocket('message:update', ({ conversationId, message }) => {
    if (conversationId === cid) setMessages((m) => m?.map((x) => (x.id === message.id ? message : x)));
  });
  useSocket('message:read', ({ conversationId, userId, lastReadId }) => {
    if (conversationId !== cid) return;
    setConv((c) => c && { ...c, members: c.members.map((m) => (m.id === userId ? { ...m, last_read_id: lastReadId } : m)) });
  });
  useSocket('typing', ({ conversationId, userId, name, typing: on }) => {
    if (conversationId === cid) setTyping((t) => ({ ...t, [userId]: on ? name : undefined }));
  });
  useSocket('conversation:update', ({ id: x }) => {
    if (x === cid) loadConv().then(() => {}).catch(() => {});
  });

  const onScroll = () => {
    const el = listRef.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  const loadOlder = async () => {
    const el = listRef.current;
    const h = el.scrollHeight;
    const r = await api(`/conversations/${cid}/messages?before=${messages[0].id}`);
    stick.current = false;
    setMessages((m) => [...r.messages, ...m]);
    setHasMore(r.hasMore);
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - h; });
  };

  const onType = (v) => {
    setText(v);
    emit('typing', { conversationId: cid, typing: true });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => emit('typing', { conversationId: cid, typing: false }), 2500);
  };

  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim() && !file) return;
    const body = { text: text.trim(), file, reply_to: replyTo?.id };
    setText(''); setFile(null); setReplyTo(null); setEmojiOpen(false);
    stick.current = true;
    emit('typing', { conversationId: cid, typing: false });
    try {
      const m = await api(`/conversations/${cid}/messages`, { method: 'POST', form: toForm(body) });
      setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
    } catch (ex) {
      toast(ex.message, 'error');
      setText(body.text);
    }
  };

  const react = async (m, emoji) => {
    setAction(null);
    await api(`/messages/${m.id}/react`, { method: 'POST', body: { emoji } }).catch((e) => toast(e.message, 'error'));
  };
  const pin = async (m) => {
    setAction(null);
    const r = await api(`/messages/${m.id}/pin`, { method: 'POST' }).catch((e) => toast(e.message, 'error'));
    if (r) toast(r.pinned ? 'Message pinned' : 'Message unpinned');
  };
  const unsend = async (m) => {
    setAction(null);
    await api(`/messages/${m.id}`, { method: 'DELETE' });
  };

  if (error) return <div className="page"><Empty icon="lock" title="Can't open this chat">{error}</Empty><button className="btn block" onClick={() => nav('/chats')}>Back to chats</button></div>;
  if (!conv || !messages) return <div className="chat-room"><Spinner /></div>;

  const others = conv.members.filter((m) => m.id !== user.id);
  const typingNames = Object.values(typing).filter(Boolean);
  const pinned = messages.filter((m) => m.pinned && !m.deleted).at(-1);
  const myLast = [...messages].reverse().find((m) => m.sender_id === user.id && m.kind === 'text');
  const seenBy = myLast ? others.filter((o) => o.last_read_id >= myLast.id) : [];
  const sub = typingNames.length ? `${typingNames[0].split(' ')[0]} is typing…`
    : conv.team ? `${conv.team.name} · ${conv.members.length} members` : conv.type === 'group' ? `${conv.members.length} members` : conv.other?.online ? 'Active now' : conv.other?.job_title || '';

  return (
    <div className="chat-room">
      <div className="chat-head">
        <button className="icon-btn" onClick={() => nav('/chats')} aria-label="Back"><Icon name="back" /></button>
        {conv.team ? <TeamLogo team={conv.team} size={38} /> : <Avatar src={conv.avatar} size={38} online={conv.type === 'direct' && conv.other?.online} onClick={() => conv.type === 'direct' && nav(`/u/${conv.other.id}`)} />}
        <div className="meta" onClick={() => nav(`/chats/${cid}/info`)} style={{ cursor: 'pointer' }}>
          <div className="title">{conv.team ? `#${conv.title}` : conv.title} <Streak n={conv.streak} /></div>
          <div className="sub" style={typingNames.length ? { color: 'var(--primary)' } : undefined}>{sub}</div>
        </div>
        <button className="icon-btn" onClick={() => nav(`/chats/${cid}/info`)} aria-label="Chat info"><Icon name="more" /></button>
      </div>
      {pinned && (
        <button className="pinned-bar" onClick={() => setPanel('pinned')}>
          <Icon name="pin" size={16} style={{ color: 'var(--fire)' }} />
          <span><b>{pinned.sender?.full_name?.split(' ')[0]}:</b> {pinned.text || (pinned.image ? '📷 Photo' : 'Shared a post')}</span>
          <Icon name="next" size={16} />
        </button>
      )}
      <div className="messages" ref={listRef} onScroll={onScroll}>
        {hasMore && <button className="btn ghost sm" style={{ alignSelf: 'center', marginBottom: 8 }} onClick={loadOlder}>Load earlier messages</button>}
        {!messages.length && <Empty icon="chat" title="No messages yet">Say hello to {conv.title.split(' ')[0]} 👋</Empty>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
          if (m.kind === 'system') return <Fragment key={m.id}>{newDay && <div className="day-sep">{dayLabel(m.created_at)}</div>}<div className="system-msg">{m.text}</div></Fragment>;
          const me = m.sender_id === user.id;
          const groupStart = newDay || !prev || prev.sender_id !== m.sender_id || prev.kind === 'system';
          const next = messages[i + 1];
          const groupEnd = !next || next.sender_id !== m.sender_id || next.kind === 'system';
          const counts = Object.entries(m.reactions.reduce((a, r) => ({ ...a, [r.emoji]: (a[r.emoji] || 0) + 1 }), {}));
          return (
            <Fragment key={m.id}>
              {newDay && <div className="day-sep">{dayLabel(m.created_at)}</div>}
              {conv.type === 'group' && !me && groupStart && <div className="msg-sender" style={{ marginLeft: 44 }}>{m.sender?.full_name}</div>}
              <div className={`msg-row ${me ? 'me' : ''}`} style={{ marginTop: groupStart ? 6 : 0 }}>
                {!me && <div style={{ width: 30 }}>{groupEnd && <Avatar user={m.sender} size={28} />}</div>}
                <div className="msg-col">
                  {m.deleted ? <div className="bubble deleted">Message unsent</div> : (
                    <>
                      {m.story && <StoryRef s={m.story} mine={me} other={conv.other?.full_name?.split(' ')[0]} />}
                      {m.note_ref && <NoteRef n={m.note_ref} mine={me} other={conv.other?.full_name?.split(' ')[0]} />}
                      {(m.text || m.reply || m.shared_post || m.highlight) && (
                        <div className={`bubble ${(m.shared_post || m.highlight) && !m.text ? 'bare' : ''}`} onClick={() => setAction(m)} title={clockTime(m.created_at)}>
                          {m.pinned ? <Icon name="pin" size={13} className="pin-tag" /> : null}
                          {m.reply && <div className="reply-ref">{m.reply.sender}: {m.reply.text || (m.reply.image ? '📷 Photo' : '')}</div>}
                          {m.shared_post && <SharedPost p={m.shared_post} />}
                          {m.highlight && <SharedHighlight h={m.highlight} />}
                          {m.text && <div style={m.shared_post || m.highlight ? { marginTop: 6 } : undefined}>{m.text}</div>}
                        </div>
                      )}
                      {m.image && <div className="bubble img" onClick={() => setAction(m)}><img src={m.image} alt="" onDoubleClick={() => setImg(m.image)} /></div>}
                      {m.attachment && <div className="bubble img" onClick={() => setAction(m)}><Attachment a={m.attachment} /></div>}
                    </>
                  )}
                  {counts.length > 0 && <div className="reactions">{counts.map(([e, n]) => <span key={e}>{e}{n > 1 ? n : ''}</span>)}</div>}
                  {myLast?.id === m.id && (
                    <div className="seen">
                      {seenBy.length ? <><Icon name="checks" size={13} style={{ color: 'var(--primary)' }} /> {conv.type === 'direct' ? 'Seen' : `Seen by ${seenBy.length}`}</> : <><Icon name="check" size={13} /> Sent</>}
                    </div>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}
        {typingNames.length > 0 && <div className="msg-row" style={{ marginTop: 6 }}><div style={{ width: 30 }} /><div className="typing"><i /><i /><i /></div></div>}
      </div>
      {replyTo && (
        <div className="reply-preview"><Icon name="reply" size={16} /><span>Replying to <b>{replyTo.sender?.full_name}</b>: {replyTo.text || '📷 Photo'}</span>
          <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setReplyTo(null)} aria-label="Cancel reply"><Icon name="close" size={16} /></button></div>
      )}
      {file && (file.type.startsWith('image/')
        ? <div style={{ padding: '0 12px', background: 'var(--bg)' }}><FilePreviews files={[file]} onRemove={() => setFile(null)} /></div>
        : <div className="reply-preview"><Icon name="clip" size={16} /><span>{file.name} · {fmtSize(file.size)}</span><button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setFile(null)} aria-label="Remove attachment"><Icon name="close" size={16} /></button></div>)}
      {emojiOpen && <div className="emoji-panel">{EMOJIS.map((e) => <button key={e} onClick={() => setText((t) => t + e)}>{e}</button>)}</div>}
      {conv.blocked ? <div className="blocked-bar">You can't message this person. <button className="link-btn" onClick={() => nav(`/chats/${cid}/info`)}>Manage</button></div> : (
      <form className="chat-input" onSubmit={send}>
        <button type="button" className="icon-btn" onClick={() => { fileRef.current.accept = 'image/*'; fileRef.current.click(); }} aria-label="Send photo"><Icon name="image" /></button>
        <button type="button" className="icon-btn" onClick={() => { fileRef.current.accept = ''; fileRef.current.click(); }} aria-label="Attach video or file"><Icon name="clip" /></button>
        <button type="button" className="icon-btn" onClick={() => setEmojiOpen(!emojiOpen)} aria-label="Emoji" style={emojiOpen ? { color: 'var(--primary)' } : undefined}><Icon name="smile" /></button>
        <textarea rows={1} placeholder="Message…" value={text} onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} aria-label="Message" />
        <button className="icon-btn" disabled={!text.trim() && !file} style={{ color: 'var(--primary)' }} aria-label="Send"><Icon name="send" /></button>
        <input ref={fileRef} type="file" hidden onChange={(e) => {
          const f = e.target.files[0];
          e.target.value = '';
          if (f && f.size > 15 * 1024 * 1024) return toast('Files can be up to 15 MB.', 'error');
          setFile(f || null);
        }} />
      </form>)}

      {action && (
        <Sheet title="" onClose={() => setAction(null)}>
          <div className="react-bar">
            {QUICK.map((e) => (
              <button key={e} className={action.reactions.some((r) => r.user_id === user.id && r.emoji === e) ? 'active' : ''} onClick={() => react(action, e)}>{e}</button>
            ))}
          </div>
          <div className="menu-list">
            <button onClick={() => { setReplyTo(action); setAction(null); }}><Icon name="reply" /> Reply</button>
            <button onClick={() => pin(action)}><Icon name="pin" /> {action.pinned ? 'Unpin' : 'Pin'} message</button>
            {action.text && <button onClick={() => { navigator.clipboard?.writeText(action.text); setAction(null); toast('Copied'); }}><Icon name="file" /> Copy text</button>}
            {action.image && <button onClick={() => { setImg(action.image); setAction(null); }}><Icon name="image" /> View photo</button>}
            {action.sender_id === user.id && <button className="danger" onClick={() => unsend(action)}><Icon name="trash" /> Unsend</button>}
            <div className="small muted" style={{ padding: '10px 4px 0' }}>Sent {new Date(action.created_at).toLocaleString()}</div>
          </div>
        </Sheet>
      )}
      {panel === 'pinned' && <PinnedSheet cid={cid} onClose={() => setPanel(null)} onUnpin={pin} />}
      <Lightbox src={img} onClose={() => setImg(null)} />
    </div>
  );
}

function PinnedSheet({ cid, onClose, onUnpin }) {
  const { data, loading, reload } = useLoad(() => api(`/conversations/${cid}/pinned`), [cid]);
  return (
    <Sheet title="Pinned messages" onClose={onClose}>
      {loading ? <Spinner /> : !data.length ? <Empty icon="pin" title="Nothing pinned">Tap a message and choose Pin.</Empty> : data.map((m) => (
        <div key={m.id} className="row-item">
          <Avatar user={m.sender} size={34} />
          <div className="meta"><div className="title">{m.sender?.full_name}</div><div className="sub" style={{ whiteSpace: 'normal' }}>{m.text || (m.image ? '📷 Photo' : 'Shared a post')}</div></div>
          <button className="btn ghost sm" onClick={async () => { await onUnpin(m); reload(); }}>Unpin</button>
        </div>
      ))}
    </Sheet>
  );
}
