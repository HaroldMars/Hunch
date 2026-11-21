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
const STICKERS = ['🍾', '🎉', '🔥', '✨', '💖', '☕', '🎧', '📚', '💼', '🏝️', '🍕', '🍜', '🏀', '🎮', '🌧️', '☀️', '🌙', '🎂', '💪', '🙏', '😂', '🥹', '😮‍💨', '🤯'];
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

export function NotesRow({ notes, onMine, onOpen }) {
  const { user } = useApp();
  const mine = notes?.mine;
  return (
    <div className="notes2" aria-label="Notes">
      <button className="n2-item" onClick={onMine} aria-label="Your note">
        <NoteBubble note={mine} placeholder="Share a note..." liked={mine?.like_count > 0} />
        <Avatar user={user} size={72} />
        <span className="n2-name muted">Your note</span>
      </button>
      {notes?.friends.map((n) => (
        <button key={n.id} className="n2-item" onClick={() => onOpen(n)}>
          <NoteBubble note={n} liked={n.liked} />
          <Avatar user={n.user} size={72} />
          <span className="n2-name">{n.user.full_name.split(' ')[0]}</span>
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
          <button className="nm-primary" onClick={onEdit}>Leave a new note</button>
          <button className="nm-link" onClick={onDelete}>Delete note</button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title={undefined} onClose={onClose}>
      <div className="nv-head"><b>{mine ? 'Your note' : note.user.full_name}</b><span> · {timeAgo(note.created_at)}</span></div>
      <div className="nv-stage">
        <button className="nv-ava" onClick={() => nav(`/u/${note.user.id}`)} aria-label="Open profile"><Avatar user={note.user} size={84} /></button>
        <NoteBubble note={note} size="md" />
      </div>
      {m && <div className="nv-mood"><i style={{ background: m.color }} />Feeling {m.label.toLowerCase()}</div>}
      {mine ? (
        <>
          <div className="nv-likes">
            {note.like_count ? <><div className="nv-faces">{note.likers.slice(0, 5).map((u) => <Avatar key={u.id} user={u} size={26} />)}</div><span>Liked by {note.likers[0]?.full_name.split(' ')[0]}{note.like_count > 1 ? ` and ${note.like_count - 1} other${note.like_count > 2 ? 's' : ''}` : ''}</span></> : <span className="muted">No likes yet</span>}
          </div>
          <div className="nv-actions">
            <button className="btn ghost" onClick={onDelete}>Delete note</button>
            <button className="btn" onClick={onEdit}>Leave a new note</button>
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

/** Full-screen composer: emoji sticker (upper-left of the bubble), bubble colour (palette on the photo), text, Share. */
export function NoteComposer({ initial, onClose, onSaved }) {
  const { user, toast, settings } = useApp();
  const max = settings.note_max_words || 35;
  const [text, setText] = useState(initial?.text || '');
  const [emoji, setEmoji] = useState(initial?.emoji || null);
  const [mood, setMood] = useState(initial?.mood || null);
  const [color, setColor] = useState(initial?.color || null);
  const [screen, setScreen] = useState('main'); // main | bubble | emoji
  const [busy, setBusy] = useState(false);
  const ta = useRef(null);
  const words = wordCount(text);
  useEffect(() => { if (screen === 'main') setTimeout(() => ta.current?.focus(), 60); }, [screen]);
  const share = async () => {
    setBusy(true);
    try {
      await api('/notes', { method: 'POST', body: { text, emoji, mood, color } });
      toast('Note shared with friends', 'success');
      onSaved(); onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const stage = (editable, c = color) => (
    <div className="nc-stage">
      <div className="nc-bubble-wrap">
        <button className={`nc-emoji ${emoji ? 'set' : ''}`} onClick={() => setScreen('emoji')} aria-label={emoji ? 'Change emoji' : 'Add emoji'}>
          {emoji || <Icon name="smile" size={22} />}{!emoji && <i>+</i>}
        </button>
        <span className={`nb nb-lg ${c ? 'tinted' : ''}`} style={bubbleStyle(c)}>
          {editable
            ? <textarea ref={ta} rows={2} value={text} maxLength={400} placeholder="Share a thought..." onChange={(e) => setText(e.target.value)} aria-label="Your note" />
            : <span className="nb-text">{text || <span className="ph">Share a thought...</span>}</span>}
        </span>
      </div>
      <div className="nc-ava">
        <Avatar user={user} size={128} />
        {editable && <button className="nc-palette" onClick={() => setScreen('bubble')} aria-label="Bubble colour">🎨</button>}
      </div>
    </div>
  );
  return (
    <div className="nc-screen" role="dialog" aria-modal="true" aria-label="New note">
      {screen === 'bubble' ? (
        <BubbleEditor renderStage={(c) => stage(false, c)} value={color} onBack={() => setScreen('main')} onApply={(c) => { setColor(c); setScreen('main'); }} />
      ) : (
        <>
          <div className="nc-top"><button className="nc-round" onClick={onClose} aria-label="Close"><Icon name="close" size={22} /></button></div>
          <div className="nc-center">
            {stage(true)}
            <div className={`nc-count ${words > max ? 'over' : ''}`}>{words}/{max} words{mood ? <> · <i style={{ background: moodByKey(mood)?.color }} />{moodByKey(mood)?.label}</> : null}</div>
          </div>
          <div className="nc-bottom">
            <span className="nc-aud"><Icon name="users" size={17} /> Share with friends</span>
            <button className="nc-share" disabled={busy || (!text.trim() && !emoji) || words > max} onClick={share}>{busy ? 'Sharing…' : 'Share'}</button>
          </div>
        </>
      )}
      {screen === 'emoji' && (
        <EmojiSheet value={emoji} onClose={() => setScreen('main')}
          onPick={(e, moodKey) => { setEmoji(e); setMood(moodKey || null); setScreen('main'); }}
          onRemove={() => { setEmoji(null); setMood(null); setScreen('main'); }} />
      )}
    </div>
  );
}

function BubbleEditor({ renderStage, value, onBack, onApply }) {
  const [pick, setPick] = useState(value);
  const [page, setPage] = useState(Math.max(0, BUBBLE_PAGES.findIndex((p) => p.includes(value))));
  const strip = useRef(null);
  useEffect(() => { strip.current?.scrollTo({ left: page * strip.current.clientWidth }); }, []);
  const onScroll = () => { const el = strip.current; if (el) setPage(Math.round(el.scrollLeft / el.clientWidth)); };
  return (
    <>
      <div className="nc-top"><button className="nc-round" onClick={onBack} aria-label="Back"><Icon name="back" size={22} /></button><h2>Bubble Editor</h2><span style={{ width: 48 }} /></div>
      <div className="nc-center">{renderStage(pick)}</div>
      <div className="be-bottom">
        <div className="be-strip" ref={strip} onScroll={onScroll}>
          {BUBBLE_PAGES.map((p, i) => (
            <div key={i} className="be-page">
              {p.map((c) => <button key={c} className={`be-sw ${pick === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setPick(c)} aria-label={`Colour ${c}`} />)}
            </div>
          ))}
        </div>
        <div className="be-dots">{BUBBLE_PAGES.map((_, i) => <button key={i} className={page === i ? 'on' : ''} aria-label={`Colour page ${i + 1}`} onClick={() => strip.current?.scrollTo({ left: i * strip.current.clientWidth, behavior: 'smooth' })} />)}</div>
        <button className="nc-apply" disabled={pick === value} onClick={() => onApply(pick)}>Apply</button>
        <button className="nc-clear" disabled={!pick && !value} onClick={() => onApply(null)}>Clear</button>
      </div>
    </>
  );
}

function EmojiSheet({ value, onPick, onClose, onRemove }) {
  return (
    <Sheet title="Add emoji" onClose={onClose}>
      <div className="es-label">How are you feeling?</div>
      <div className="es-moods">
        {MOODS.map((m) => (
          <button key={m.key} className={value === m.emoji ? 'on' : ''} onClick={() => onPick(m.emoji, m.key)}>
            <span>{m.emoji}</span><small>{m.label}</small>
          </button>
        ))}
      </div>
      <div className="es-label">Stickers</div>
      <div className="es-grid">{STICKERS.map((e) => <button key={e} className={value === e ? 'on' : ''} onClick={() => onPick(e)}>{e}</button>)}</div>
      {value && <button className="btn ghost block" style={{ marginTop: 14 }} onClick={onRemove}>Remove emoji</button>}
    </Sheet>
  );
}
