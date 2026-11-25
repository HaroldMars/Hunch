import { useEffect, useRef, useState } from 'react';
import Icon from '@shared/Icon.jsx';
import { moodByKey } from '@shared/constants.js';

/** Photo effects (applied as a CSS filter on the photo in the editor and the viewer). */
export const STORY_EFFECTS = [
  { key: null, label: 'Original', css: 'none' },
  { key: 'warm', label: 'Warm', css: 'sepia(0.22) saturate(1.25) hue-rotate(-6deg)' },
  { key: 'cool', label: 'Cool', css: 'saturate(1.1) hue-rotate(10deg) brightness(1.03)' },
  { key: 'vivid', label: 'Vivid', css: 'saturate(1.55) contrast(1.08)' },
  { key: 'mono', label: 'Mono', css: 'grayscale(1) contrast(1.12)' },
  { key: 'fade', label: 'Fade', css: 'contrast(0.88) brightness(1.08) saturate(0.8)' },
  { key: 'dream', label: 'Dream', css: 'brightness(1.08) saturate(1.2) contrast(0.95)' },
];
export const effectCss = (k) => STORY_EFFECTS.find((e) => e.key === k)?.css || 'none';
export const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.round(sec) % 60).padStart(2, '0')}`;

/** Remaining time for countdown stickers, e.g. "2d 4h" / "3h 12m" / "Now". */
export const untilText = (iso) => {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return 'Now';
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
};

/** Pointer-drag helper: reports positions as fractions (0..1) of the container. */
function useDrag(containerRef, enabled, onMove) {
  return (e) => {
    if (!enabled) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget;
    const box = containerRef.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    el.setPointerCapture?.(e.pointerId);
    const move = (ev) => onMove({
      x: Math.max(0, Math.min(1 - r.width / box.width, (ev.clientX - dx - box.left) / box.width)),
      y: Math.max(0, Math.min(1 - r.height / box.height, (ev.clientY - dy - box.top) / box.height)),
    });
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
}

function Sticker({ st, i, containerRef, editable, onMove, onRemove, actions }) {
  const drag = useDrag(containerRef, editable, (pos) => onMove(i, pos));
  const [answer, setAnswer] = useState('');
  const [, tick] = useState(0);
  useEffect(() => { if (st.type !== 'countdown') return undefined; const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, [st.type]);
  const style = { left: `${st.pos.x * 100}%`, top: `${st.pos.y * 100}%` };
  const stop = (e) => e.stopPropagation();
  const total = st.counts ? st.counts.reduce((a, b) => a + b, 0) : 0;
  return (
    <div className={`so-sticker so-${st.type} ${editable ? 'editable' : ''}`} style={style} onPointerDown={drag} onMouseDown={stop} onTouchStart={stop}>
      {editable && <button className="so-x" onPointerDown={stop} onClick={() => onRemove(i)} aria-label="Remove sticker">×</button>}
      {st.type === 'poll' && (
        <>
          <b className="so-q">{st.question}</b>
          {st.options.map((o, k) => {
            const pct = total ? Math.round(((st.counts?.[k] || 0) / total) * 100) : 0;
            const voted = st.my_vote !== null && st.my_vote !== undefined;
            return (
              <button key={k} className={`so-opt ${st.my_vote === k ? 'mine' : ''}`} disabled={editable || !actions?.onPoll} onClick={() => actions.onPoll(k)}>
                {voted && <i style={{ width: `${pct}%` }} />}<span>{o}</span>{voted && <em>{pct}%</em>}
              </button>
            );
          })}
        </>
      )}
      {st.type === 'question' && (
        <>
          <b className="so-q">{st.prompt}</b>
          {actions?.onAnswer ? (
            <form className="so-answer" onSubmit={(e) => { e.preventDefault(); if (answer.trim()) { actions.onAnswer(answer); setAnswer(''); } }}>
              <input value={answer} onChange={(e) => setAnswer(e.target.value)} onFocus={actions.onFocus} onBlur={actions.onBlur} placeholder="Type something..." maxLength={500} />
              {answer.trim() && <button aria-label="Send answer"><Icon name="send" size={16} /></button>}
            </form>
          ) : <div className="so-answer ph">Type something...</div>}
        </>
      )}
      {st.type === 'countdown' && <><small>{st.title}</small><b className="so-count">{untilText(st.ends_at)}</b><small>{new Date(st.ends_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></>}
      {st.type === 'link' && <a href={editable ? undefined : st.url} target="_blank" rel="noopener noreferrer nofollow" onClick={stop}><Icon name="link" size={15} /> {st.label}</a>}
      {st.type === 'mention' && <button onClick={() => !editable && actions?.onMention?.(st.user_id)}>@{st.name}</button>}
      {st.type === 'hashtag' && <span>#{st.tag}</span>}
      {st.type === 'announcement' && <span><Icon name="megaphone" size={15} /> Work announcement</span>}
    </div>
  );
}

/**
 * Everything drawn on top of a story. The content pieces (caption, mood, location, music) are a structured
 * stack at the bottom, not floating stickers. Older stories may still carry stickers, which render as before.
 * editable: the creator. actions: viewer interactions (poll, answer, mention, onPlace, onPiece).
 */
export function StoryOverlays({ s, containerRef, editable = false, onMoveSticker, onRemoveSticker, actions, compact }) {
  const m = moodByKey(s.mood);
  const caption = s.text && (s.image || s.drawn);
  const hasStack = caption || m || s.place_name || s.music;
  const piece = (k) => (e) => { e.stopPropagation(); actions?.onPiece?.(k); };
  return (
    <div className={`so-layer ${compact ? 'compact' : ''}`}>
      {hasStack && (
        <div className="so-stack">
          {caption && <div className="so-caption" onClick={piece('caption')}>{s.text}</div>}
          <div className="so-row">
            {m && <button className="so-mood" onClick={piece('mood')}>{m.emoji} Feeling {m.label}</button>}
            {s.place_name && (
              <button className="so-place" onClick={(e) => { e.stopPropagation(); if (actions?.onPiece) actions.onPiece('location'); else if (s.show_on_map && actions?.onPlace) actions.onPlace(s); }}>
                <span className="pin"><Icon name="location" size={14} /></span><b>{s.place_name}</b>{s.show_on_map ? <small>Map</small> : null}
              </button>
            )}
          </div>
          {s.music && (
            <button className="so-music" onClick={(e) => { e.stopPropagation(); if (actions?.onPiece) actions.onPiece('music'); else actions?.onMusic?.(); }}>
              <span className={`eq ${actions?.playing ? 'on' : ''}`}><i /><i /><i /></span>
              <span className="t"><b>{s.music.title}</b>{s.music.artist && <small>{s.music.artist}</small>}</span>
              <span className="d">{mmss(s.music.duration || 30)}</span>
            </button>
          )}
        </div>
      )}
      {(s.stickers || []).map((st, i) => (
        <Sticker key={i} st={st} i={i} containerRef={containerRef} editable={editable} onMove={onMoveSticker} onRemove={onRemoveSticker} actions={actions} />
      ))}
    </div>
  );
}
