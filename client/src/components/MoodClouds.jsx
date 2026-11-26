import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { MOODS, moodByKey, wordCount } from '@shared/constants.js';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { Avatar, Sheet, timeAgo } from './ui.jsx';

// Bubble colours, paged like Instagram's Bubble Editor.
export const BUBBLE_PAGES = [
  ['#c4a1ff', '#8b3dff', '#4a00b4', '#f986e8', '#e600c8', '#9b0086'],
  ['#9cc8ff', '#3d8bff', '#0a3d91', '#7fe0f5', '#00a6d6', '#005c7a'],
  ['#b6eda8', '#3fc55a', '#1d6b2c', '#d7f06b', '#9ac400', '#5a7300'],
  ['#ffd27a', '#ffa200', '#c45c00', '#ff9d8a', '#ff4b2b', '#a3150a'],
  ['#ffffff', '#e4e4e8', '#a1a1aa', '#52525b', '#27272a', '#000000'],
];
const QUICK = ['😘', '😂', '😭'];

/** Readable text on any bubble colour. */
const inkFor = (hex) => {
  if (!hex) return null;
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 165 ? '#111' : '#fff';
};
const bubbleStyle = (color) => (color ? { '--nb': color, '--nb-ink': inkFor(color) } : undefined);

/** The note bubble: soft gray (or chosen colour), tail dots, emoji sticker at the upper-left. */
export function NoteBubble({ note, placeholder, size = 'sm', liked, children }) {
  return (
    <span className={`nb nb-${size} ${note?.color ? 'tinted' : ''} ${note || children ? '' : 'empty'}`} style={bubbleStyle(note?.color)}>
      {note?.emoji && <span className="nb-sticker">{note.emoji}</span>}
      {liked && <span className="nb-heart">❤️</span>}
      <span className="nb-text">{children || (note ? note.text || (note.emoji ? '' : note.moodInfo?.label) : placeholder)}</span>
    </span>
  );
}

/** A soft gray glass cloud with the mood (or category) and a short note. */
export function Cloud({ note, placeholder, liked }) {
  const icon = note?.emoji || note?.moodInfo?.emoji || '☁️';
  const text = note ? (note.text || note.moodInfo?.label || '') : placeholder;
  return (
    <span className={`mcl ${note ? '' : 'empty'}`}>
      <span className="mcl-puff" aria-hidden="true" />
      <span className="mcl-body">
        <span className="mcl-emoji">{note ? icon : '+'}</span>
        {text && <span className="mcl-text">{text}</span>}
      </span>
      {liked && <span className="mcl-heart">❤️</span>}
    </span>
  );
}

/** Mood Clouds: the top of Chats. Your cloud first, then friends' clouds (each disappears after 24 hours). */
export function MoodCloudsRow({ notes, onMine, onOpen }) {
  const { user } = useApp();
  const mine = notes?.mine;
  return (
    <div className="clouds" aria-label="Mood Clouds">
      <button className="cl-item" onClick={onMine} aria-label={mine ? 'Your Mood Cloud' : 'Share a Mood Cloud'}>
        <Cloud note={mine} placeholder="Your mood" liked={mine?.like_count > 0} />
        <Avatar user={user} size={64} />
        <span className="cl-name muted">Your cloud</span>
      </button>
      {notes?.friends.map((n) => (
        <button key={n.id} className="cl-item" onClick={() => onOpen(n)}>
          <Cloud note={n} liked={n.liked} />
          <Avatar user={n.user} size={64} />
          <span className="cl-name">{n.user.full_name.split(' ')[0]}</span>
        </button>
      ))}
    </div>
  );
}

/** Open a note. Others: like + private reply. Mine: likes, delete, new note. */
export function NoteView({ note: initial, onClose, onEdit, onDelete, onChanged }) {
  const { user, toast } = useApp();
  const nav = useNavigate();
  const [note, setNote] = useState(initial);
  const [text, setText] = useState('');
  const mine = note.user_id === user.id;
  const m = note.moodInfo;
  const like = async () => {
    setNote((n) => ({ ...n, liked: !n.liked }));
    try { const r = await api(`/notes/${note.id}/like`, { method: 'POST' }); setNote((n) => ({ ...n, ...r })); onChanged?.(); } catch (e) { toast(e.message, 'error'); }
  };
  const reply = async (msg) => {
    if (!msg.trim()) return;
    try { await api(`/notes/${note.id}/reply`, { method: 'POST', body: { text: msg } }); setText(''); toast('Sent', 'success'); } catch (e) { toast(e.message, 'error'); }
  };
  // Your own note: centred and quiet, one primary action and one text action.
  if (mine) {
    return (
      <Sheet title={undefined} onClose={onClose}>
        <div className="nm-body">
          <div className="nm-ava"><Avatar user={note.user} size={88} />{note.emoji && <span className="nm-sticker">{note.emoji}</span>}</div>
          {note.text && <p className="nm-text" style={note.color ? { color: undefined } : undefined}>{note.text}</p>}
          <div className="nm-meta">Shared with friends · {timeAgo(note.created_at)}{m ? <> · <i style={{ background: m.color }} />{m.label}</> : null}</div>
          {note.like_count > 0 && (
            <div className="nm-likes"><div className="nv-faces">{note.likers.slice(0, 3).map((u) => <Avatar key={u.id} user={u} size={22} />)}</div>
              Liked by <b>{note.likers[0]?.full_name.split(' ')[0]}</b>{note.like_count > 1 ? ` and ${note.like_count - 1} other${note.like_count > 2 ? 's' : ''}` : ''}</div>
          )}
        </div>
        <div className="nm-actions">
          <button className="nm-primary" onClick={onEdit}>Share a new cloud</button>
          <button className="nm-link" onClick={onDelete}>Delete cloud</button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title={undefined} onClose={onClose}>
      <div className="nv-head"><b>{mine ? 'Your cloud' : note.user.full_name}</b><span> · {timeAgo(note.created_at)}</span></div>
      <div className="nv-stage cl-stage">
        <Cloud note={note} />
        <button className="nv-ava" onClick={() => nav(`/u/${note.user.id}`)} aria-label="Open profile"><Avatar user={note.user} size={84} /></button>
      </div>
      {m && <div className="nv-mood"><i style={{ background: m.color }} />Feeling {m.label.toLowerCase()}</div>}
      {mine ? (
        <>
          <div className="nv-likes">
            {note.like_count ? <><div className="nv-faces">{note.likers.slice(0, 5).map((u) => <Avatar key={u.id} user={u} size={26} />)}</div><span>Liked by {note.likers[0]?.full_name.split(' ')[0]}{note.like_count > 1 ? ` and ${note.like_count - 1} other${note.like_count > 2 ? 's' : ''}` : ''}</span></> : <span className="muted">No likes yet</span>}
          </div>
          <div className="nv-actions">
            <button className="btn ghost" onClick={onDelete}>Delete cloud</button>
            <button className="btn" onClick={onEdit}>Share a new cloud</button>
          </div>
        </>
      ) : (
        <form className="nv-reply" onSubmit={(e) => { e.preventDefault(); reply(text); }}>
          <div className="nv-input">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Reply to ${note.user.full_name.split(' ')[0]}`} maxLength={1000} aria-label="Reply privately" />
            {text.trim() ? <button className="nv-send">Send</button> : QUICK.map((q) => <button type="button" key={q} className="nv-quick" onClick={() => reply(q)} aria-label={`Reply ${q}`}>{q}</button>)}
          </div>
          <button type="button" className={`nv-like ${note.liked ? 'on' : ''}`} onClick={like} aria-label={note.liked ? 'Unlike note' : 'Like note'}>
            <Icon name="heart" size={28} fill={note.liked ? 'currentColor' : 'none'} />
          </button>
        </form>
      )}
    </Sheet>
  );
}

// ---------- Note composer (create / edit): the Mood Cloud editor ----------
// A soft cloud card instead of a speech bubble: pick a category, an optional mood, write a few words.
export const NOTE_CATEGORIES = [
  { key: 'thought', icon: '☁️', label: 'Thought', ph: 'What’s on your mind?' },
  { key: 'mood', icon: '😊', label: 'Mood', ph: 'How’s your day going?' },
  { key: 'question', icon: '❓', label: 'Question', ph: 'Ask your friends something…' },
  { key: 'quote', icon: '❝', label: 'Quote', ph: 'A line worth sharing…' },
  { key: 'update', icon: '📅', label: 'Daily Update', ph: 'Today I…' },
  { key: 'achievement', icon: '🏆', label: 'Achievement', ph: 'Something you’re proud of…' },
];

export function NoteComposer({ initial, onClose, onSaved }) {
  const { user, toast, settings } = useApp();
  const max = settings.note_max_words || 35;
  const [text, setText] = useState(initial?.text || '');
  const [mood, setMood] = useState(initial?.mood || null);
  const [category, setCategory] = useState(initial?.category || 'thought');
  const [busy, setBusy] = useState(false);
  const ta = useRef(null);
  const words = wordCount(text);
  const m = moodByKey(mood);
  const cat = NOTE_CATEGORIES.find((c) => c.key === category) || NOTE_CATEGORIES[0];
  useEffect(() => { setTimeout(() => ta.current?.focus(), 80); }, []);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const canShare = !busy && (text.trim() || mood) && words <= max;
  const share = async () => {
    setBusy(true);
    try {
      // The emoji shown on the note bubble: the mood's emoji, otherwise the category's.
      await api('/notes', { method: 'POST', body: { text, mood, category, emoji: m?.emoji || (category !== 'thought' ? cat.icon : null) } });
      toast(initial ? 'Mood Cloud updated' : 'Mood Cloud shared with friends', 'success');
      onSaved(); onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="nc-screen cn" role="dialog" aria-modal="true" aria-label={initial ? 'Edit Mood Cloud' : 'New Mood Cloud'}>
      <div className="cn-top">
        <button className="cn-icon" onClick={onClose} aria-label="Close"><Icon name="close" size={22} /></button>
        <h2>{initial ? 'Edit Mood Cloud' : 'New Mood Cloud'}</h2>
        <button className="cn-share" disabled={!canShare} onClick={share}>{busy ? 'Sharing…' : 'Share'}</button>
      </div>

      <div className="cn-body">
        <div className={`cn-cloud cn-${category}`}>
          <div className="cn-head">
            <Avatar user={user} size={44} />
            <div className="cn-who">
              <b>{user.full_name}</b>
              <span className="cn-tag">{m ? <>{m.emoji} {m.label}</> : <>{cat.icon} {cat.label}</>}</span>
            </div>
          </div>
          <textarea ref={ta} rows={3} value={text} maxLength={400} placeholder={cat.ph} onChange={(e) => setText(e.target.value)} aria-label="Your note" />
          <div className={`cn-count ${words > max ? 'over' : ''}`}>{words}/{max} words</div>
        </div>

        <div className="cn-section">
          <div className="cn-label">Type</div>
          <div className="cn-chips" role="radiogroup" aria-label="Note type">
            {NOTE_CATEGORIES.map((c) => (
              <button key={c.key} role="radio" aria-checked={category === c.key} className={category === c.key ? 'on' : ''} onClick={() => setCategory(c.key)}>
                <span>{c.icon}</span>{c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="cn-section">
          <div className="cn-label">Mood <small>optional</small></div>
          <div className="cn-moods">
            {MOODS.map((x) => (
              <button key={x.key} className={mood === x.key ? 'on' : ''} aria-pressed={mood === x.key} onClick={() => setMood(mood === x.key ? null : x.key)}>
                <span>{x.emoji}</span><small>{x.label}</small>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="cn-foot"><Icon name="users" size={16} /> Your Mood Cloud is shared with friends · disappears in 24 hours</div>
    </div>
  );
}
