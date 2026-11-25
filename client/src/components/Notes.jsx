import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { MOODS, moodByKey, wordCount } from '@shared/constants.js';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { Avatar, Sheet, timeAgo } from './ui.jsx';

// Mood Clouds: Hunch's take on short status notes. A soft cloud card (not a speech bubble)
// with a category, an optional mood and a few words. One active cloud per person.
export const CLOUD_CATEGORIES = [
  { key: 'thought', icon: '☁️', label: 'Thought' },
  { key: 'mood', icon: '😊', label: 'Mood' },
  { key: 'question', icon: '❓', label: 'Question' },
  { key: 'quote', icon: '❝', label: 'Quote' },
  { key: 'update', icon: '📅', label: 'Daily Update' },
  { key: 'achievement', icon: '🏆', label: 'Achievement' },
];
const categoryOf = (k) => CLOUD_CATEGORIES.find((c) => c.key === k) || CLOUD_CATEGORIES[0];
const QUICK = ['❤️', '😂', '🙌'];

/** The tag under the name: "☁️ Happy" for a mood, otherwise the category. */
function CloudTag({ note }) {
  const m = note.moodInfo || moodByKey(note.mood);
  const c = categoryOf(note.category);
  return (
    <span className="mc-tag">
      {m ? <>{m.emoji} {m.label}</> : <>{c.icon} {c.label}</>}
      {m && note.category && note.category !== 'thought' && note.category !== 'mood' && <em>· {c.label}</em>}
    </span>
  );
}

/** One Mood Cloud card. */
export function MoodCloud({ note, onClick, size = 'md', children }) {
  const quote = note.category === 'quote';
  return (
    <div className={`mood-cloud mc-${note.category || 'thought'} mc-${size}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick()) : undefined}>
      <div className="mc-head">
        <Avatar user={note.user} size={size === 'lg' ? 48 : 38} />
        <div className="mc-who"><b>{note.user?.full_name}</b><CloudTag note={note} /></div>
        {note.liked && <span className="mc-liked" aria-label="You liked this">❤️</span>}
      </div>
      {note.text && <p className={`mc-text ${quote ? 'quote' : ''}`}>{quote ? `“${note.text}”` : note.text}</p>}
      <div className="mc-time">{timeAgo(note.created_at)}{note.like_count ? ` · ${note.like_count} like${note.like_count > 1 ? 's' : ''}` : ''}</div>
      {children}
    </div>
  );
}

/** The "Mood Clouds" area above the chat list: your cloud first, then friends'. */
export function MoodClouds({ notes, onMine, onOpen }) {
  const { user } = useApp();
  const [all, setAll] = useState(false);
  const mine = notes?.mine;
  const friends = notes?.friends || [];
  const shown = all ? friends : friends.slice(0, 3);
  return (
    <section className="mood-clouds" aria-label="Mood Clouds">
      <div className="mcs-head">
        <span className="mcs-rule" /><h3>Mood Clouds</h3><span className="mcs-rule" />
      </div>
      {mine ? <MoodCloud note={{ ...mine, user }} onClick={onMine} /> : (
        <button className="mc-new" onClick={onMine}>
          <Avatar user={user} size={38} />
          <span><b>Share a Mood Cloud</b><small>A thought, a mood, a win. Friends see it for 24 hours.</small></span>
          <span className="mc-plus"><Icon name="plus" size={18} /></span>
        </button>
      )}
      {shown.map((n) => <MoodCloud key={n.id} note={n} onClick={() => onOpen(n)} />)}
      {friends.length > 3 && (
        <button className="mcs-more" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${friends.length} clouds`}</button>
      )}
      {notes && !friends.length && <p className="mcs-empty">No clouds from friends right now.</p>}
    </section>
  );
}

/** Open a cloud. Others: like + private reply. Yours: likes, delete, new cloud. */
export function NoteView({ note: initial, onClose, onEdit, onDelete, onChanged }) {
  const { user, toast } = useApp();
  const nav = useNavigate();
  const [note, setNote] = useState(initial);
  const [text, setText] = useState('');
  const mine = note.user_id === user.id;
  const like = async () => {
    setNote((n) => ({ ...n, liked: !n.liked }));
    try { const r = await api(`/notes/${note.id}/like`, { method: 'POST' }); setNote((n) => ({ ...n, ...r })); onChanged?.(); } catch (e) { toast(e.message, 'error'); }
  };
  const reply = async (msg) => {
    if (!msg.trim()) return;
    try { await api(`/notes/${note.id}/reply`, { method: 'POST', body: { text: msg } }); setText(''); toast('Sent', 'success'); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Sheet title={undefined} onClose={onClose}>
      <div className="mc-view">
        <MoodCloud note={{ ...note, user: note.user || user, liked: false }} size="lg" onClick={mine ? undefined : () => nav(`/u/${note.user.id}`)} />
      </div>
      {mine ? (
        <>
          <div className="nm-likes" style={{ justifyContent: 'center' }}>
            {note.like_count ? <><div className="nv-faces">{note.likers.slice(0, 3).map((u) => <Avatar key={u.id} user={u} size={22} />)}</div>
              Liked by <b>{note.likers[0]?.full_name.split(' ')[0]}</b>{note.like_count > 1 ? ` and ${note.like_count - 1} other${note.like_count > 2 ? 's' : ''}` : ''}</> : <span className="muted">Shared with friends · no likes yet</span>}
          </div>
          <div className="nm-actions">
            <button className="nm-primary" onClick={onEdit}>New Mood Cloud</button>
            <button className="nm-link" onClick={onDelete}>Delete cloud</button>
          </div>
        </>
      ) : (
        <form className="nv-reply" onSubmit={(e) => { e.preventDefault(); reply(text); }}>
          <div className="nv-input">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Reply to ${note.user.full_name.split(' ')[0]}`} maxLength={1000} aria-label="Reply privately" />
            {text.trim() ? <button className="nv-send">Send</button> : QUICK.map((q) => <button type="button" key={q} className="nv-quick" onClick={() => reply(q)} aria-label={`Reply ${q}`}>{q}</button>)}
          </div>
          <button type="button" className={`nv-like ${note.liked ? 'on' : ''}`} onClick={like} aria-label={note.liked ? 'Unlike' : 'Like'}>
            <Icon name="heart" size={28} fill={note.liked ? 'currentColor' : 'none'} />
          </button>
        </form>
      )}
    </Sheet>
  );
}

/** Compose a Mood Cloud: category, optional mood, a few words. */
export function NoteComposer({ initial, onClose, onSaved }) {
  const { user, toast, settings } = useApp();
  const max = settings.note_max_words || 35;
  const [text, setText] = useState(initial?.text || '');
  const [mood, setMood] = useState(initial?.mood || null);
  const [category, setCategory] = useState(initial?.category || 'thought');
  const [busy, setBusy] = useState(false);
  const ta = useRef(null);
  const words = wordCount(text);
  useEffect(() => { setTimeout(() => ta.current?.focus(), 80); }, []);
  const m = moodByKey(mood);
  const share = async () => {
    setBusy(true);
    try {
      await api('/notes', { method: 'POST', body: { text, mood, category, emoji: m?.emoji || null } });
      toast('Mood Cloud shared with friends', 'success');
      onSaved(); onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const ph = { thought: 'What’s on your mind?', mood: 'How’s your day going?', question: 'Ask your friends something…', quote: 'A line worth sharing…', update: 'Today I…', achievement: 'Something you’re proud of…' }[category];
  return (
    <Sheet title="New Mood Cloud" onClose={onClose}
      footer={<button className="btn block" disabled={busy || (!text.trim() && !mood) || words > max} onClick={share}>{busy ? 'Sharing…' : 'Share cloud'}</button>}>
      <div className="mc-chips" role="radiogroup" aria-label="Category">
        {CLOUD_CATEGORIES.map((c) => (
          <button key={c.key} role="radio" aria-checked={category === c.key} className={category === c.key ? 'on' : ''} onClick={() => setCategory(c.key)}>{c.icon} {c.label}</button>
        ))}
      </div>
      <div className={`mood-cloud mc-${category} mc-md mc-compose`}>
        <div className="mc-head">
          <Avatar user={user} size={38} />
          <div className="mc-who"><b>{user.full_name}</b><CloudTag note={{ mood, category }} /></div>
        </div>
        <textarea ref={ta} rows={3} value={text} maxLength={400} placeholder={ph} onChange={(e) => setText(e.target.value)} aria-label="Your Mood Cloud" />
        <div className={`mc-time ${words > max ? 'over' : ''}`}>{words}/{max} words · friends · 24h</div>
      </div>
      <div className="sc-label">Mood (optional)</div>
      <div className="mc-moods">
        {MOODS.map((x) => (
          <button key={x.key} className={mood === x.key ? 'on' : ''} onClick={() => setMood(mood === x.key ? null : x.key)} aria-pressed={mood === x.key}>
            <span>{x.emoji}</span><small>{x.label}</small>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
