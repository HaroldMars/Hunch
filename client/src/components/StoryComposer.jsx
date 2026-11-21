import { useEffect, useRef, useState } from 'react';
import Icon from '@shared/Icon.jsx';
import { MOODS, THEMES, moodByKey, themeCss } from '@shared/constants.js';
import { api, toForm } from '../api.js';
import { useApp } from '../store.jsx';
import { Avatar, Sheet, Spinner, useLoad } from './ui.jsx';
import { PlaceSearch, currentPosition } from './Places.jsx';
import { StoryOverlays } from './StoryOverlays.jsx';
import { StoryViewer } from './Stories.jsx';

const AUDIENCE = {
  public: { icon: '🌎', label: 'Public', sub: 'All your friends. Location stories can be discovered on the Map.' },
  friends: { icon: '👥', label: 'Friends', sub: 'Only your accepted friends.' },
  close_friends: { icon: '⭐', label: 'Close Friends', sub: 'Only people on your Close Friends list.' },
  team: { icon: '💼', label: 'Team Only', sub: 'Only your team.' },
  private: { icon: '🔒', label: 'Private', sub: 'Only you. Saved to your archive.' },
};
const RECENT_PLACES = 'hunch_recent_places';
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_PLACES) || '[]'); } catch { return []; } };
const saveRecent = (p) => { try { localStorage.setItem(RECENT_PLACES, JSON.stringify([p, ...readRecent().filter((x) => x.name !== p.name)].slice(0, 5))); } catch { /* ignore */ } };

export default function StoryComposer({ onClose, onCreated }) {
  const { user, toast } = useApp();
  const ctx = useLoad(() => api('/work/context').catch(() => ({ team: null })), []);
  const team = ctx.data?.team && !ctx.data.overseer ? ctx.data.team : null;
  const canvas = useRef(null);
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [theme, setTheme] = useState('ocean');
  const [mood, setMood] = useState(null);
  const [text, setText] = useState('');
  const [place, setPlace] = useState(null);
  const [stickers, setStickers] = useState([]);
  const [drawing, setDrawing] = useState(null); // { strokes } once the user draws
  const [audience, setAudience] = useState('friends');
  const [target, setTarget] = useState('story'); // 'story' | 'close'
  const [opts, setOpts] = useState({ allow_replies: true, allow_reactions: true, allow_comments: false, allow_sharing: true, show_on_map: true, archive: true, duration_hours: 24 });
  const [sheet, setSheet] = useState(null);
  const [preview, setPreview] = useState(false);
  const [moreTools, setMoreTools] = useState(false); // the chevron reveals the extra side buttons
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!file) { setFileUrl(null); return undefined; } const u = URL.createObjectURL(file); setFileUrl(u); return () => URL.revokeObjectURL(u); }, [file]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && !sheet && !preview && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [sheet, preview]);

  const effectiveAudience = target === 'close' ? 'close_friends' : audience;
  const work = effectiveAudience === 'team';
  // Work announcements only make sense on Team Only stories.
  useEffect(() => { if (!work) setStickers((l) => l.filter((s) => s.type !== 'announcement')); }, [work]);

  const draft = { id: 'draft', user_id: user.id, image: fileUrl, drawn: !!drawing, theme, mood, text, place_name: place?.name, show_on_map: place && opts.show_on_map, stickers: stickers.map((s) => (s.type === 'poll' ? { ...s, counts: s.options.map(() => 0), my_vote: null } : s)), created_at: new Date().toISOString(), allow_replies: opts.allow_replies, allow_reactions: opts.allow_reactions, allow_sharing: opts.allow_sharing, audience: effectiveAudience };
  const addSticker = (st) => { setStickers((l) => [...l, { pos: { x: 0.18 + Math.random() * 0.2, y: 0.42 + Math.random() * 0.12 }, ...st }]); setSheet(null); };

  async function composite() {
    // Merge the drawing onto the photo (or template) so the story keeps it.
    const W = 1080, H = 1920;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    if (fileUrl) {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = fileUrl; });
      const sc = Math.max(W / img.width, H / img.height);
      g.drawImage(img, (W - img.width * sc) / 2, (H - img.height * sc) / 2, img.width * sc, img.height * sc);
    } else {
      const cols = (themeCss(theme).match(/#[0-9a-f]{6}/gi) || ['#141414', '#3a3a3a']);
      const grd = g.createLinearGradient(0, 0, W * 0.35, H);
      cols.forEach((col, i) => grd.addColorStop(i / Math.max(1, cols.length - 1), col));
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
    }
    const box = canvas.current.getBoundingClientRect();
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const s of drawing.strokes) {
      g.strokeStyle = s.color; g.lineWidth = s.size * (W / box.width);
      g.beginPath(); s.points.forEach(([x, y], k) => (k ? g.lineTo(x * W, y * H) : g.moveTo(x * W, y * H))); g.stroke();
    }
    return new Promise((res) => c.toBlob((b) => res(new File([b], 'story.png', { type: 'image/png' })), 'image/png'));
  }

  const post = async () => {
    setBusy(true);
    try {
      const image = drawing?.strokes.length ? await composite() : file;
      const fields = {
        image, text, mood, theme, audience: effectiveAudience,
        allow_replies: opts.allow_replies ? '1' : '0', allow_reactions: opts.allow_reactions ? '1' : '0', allow_comments: opts.allow_comments ? '1' : '0',
        allow_sharing: opts.allow_sharing ? '1' : '0', show_on_map: opts.show_on_map ? '1' : '0', archive: opts.archive || effectiveAudience === 'private' ? '1' : '0',
        duration_hours: String(opts.duration_hours), stickers: JSON.stringify(stickers),
        ...(place ? { place_name: place.name, lat: String(place.lat), lng: String(place.lng) } : {}),
      };
      const s = await api('/stories', { method: 'POST', form: toForm(fields) });
      toast(effectiveAudience === 'close_friends' ? 'Shared with Close Friends' : effectiveAudience === 'team' ? `Shared with ${team?.name || 'your team'}` : 'Mood Story shared', 'success');
      onCreated?.(s); onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const empty = !fileUrl && !mood && !text && !stickers.length && !drawing;
  const a = AUDIENCE[audience];

  return (
    <div className="sc-screen" role="dialog" aria-modal="true" aria-label="Create story">
      <div className="sc-canvas" ref={canvas} style={{ background: fileUrl ? '#000' : themeCss(theme) }}>
        {fileUrl && <img className="sc-media" src={fileUrl} alt="" />}
        {!fileUrl && !text && !drawing && !mood && (
          <button className="sc-add-media" onClick={() => fileRef.current.click()}><Icon name="camera" size={30} /><b>Add photo</b><small>or tap Aa to write a text story</small></button>
        )}
        {!fileUrl && (text || mood) && <div className="sc-text-only" onClick={() => setSheet('caption')}>{mood && <span>{moodByKey(mood)?.emoji}</span>}{text}</div>}
        <DrawLayer active={sheet === 'draw'} value={drawing} onChange={setDrawing} />
        <StoryOverlays s={fileUrl ? { ...draft, text: '' } : { ...draft, text: '', mood: null }} containerRef={canvas} editable compact
          onMoveSticker={(i, pos) => setStickers((l) => l.map((st, k) => (k === i ? { ...st, pos } : st)))}
          onRemoveSticker={(i) => setStickers((l) => l.filter((_, k) => k !== i))} />

        {sheet !== 'draw' && (
          <>
            {/* Floating controls, Instagram-style: close top-left, tools down the right side. */}
            <button className="sc-float sc-close" onClick={onClose} aria-label="Close"><Icon name="close" size={22} /></button>
            <div className="sc-side" role="toolbar" aria-label="Story tools">
              <button className={`sc-float ${text ? 'on' : ''}`} onClick={() => setSheet('caption')} aria-label="Text"><span className="aa">Aa</span></button>
              <button className={`sc-float ${stickers.length ? 'on' : ''}`} onClick={() => setSheet('more')} aria-label="Stickers"><Icon name="sticker" size={22} /></button>
              <button className={`sc-float ${mood ? 'on' : ''}`} onClick={() => setSheet('mood')} aria-label="Mood">{mood ? <span className="emo">{moodByKey(mood)?.emoji}</span> : <Icon name="smile" size={22} />}</button>
              <button className={`sc-float ${place ? 'on' : ''}`} onClick={() => setSheet('location')} aria-label="Location"><Icon name="location" size={22} /></button>
              {moreTools && (
                <>
                  <button className={`sc-float ${drawing ? 'on' : ''}`} onClick={() => setSheet('draw')} aria-label="Draw"><Icon name="edit" size={21} /></button>
                  <button className="sc-float" onClick={() => setSheet('templates')} aria-label="Backgrounds"><Icon name="sparkle" size={21} /></button>
                  <button className="sc-float" onClick={() => setPreview(true)} disabled={empty} aria-label="Preview story"><Icon name="eye" size={21} /></button>
                  <button className="sc-float" onClick={() => setSheet('settings')} aria-label="Story settings"><Icon name="settings" size={21} /></button>
                </>
              )}
              <button className="sc-float sc-chev" onClick={() => setMoreTools(!moreTools)} aria-label={moreTools ? 'Fewer tools' : 'More tools'} aria-expanded={moreTools}><Icon name="down" size={20} style={{ transform: moreTools ? 'rotate(180deg)' : 'none' }} /></button>
            </div>
            {fileUrl && <button className="sc-caption-in" onClick={() => setSheet('caption')}>{text || 'Add a caption...'}</button>}
            {fileUrl && <button className="sc-media-btn" onClick={() => fileRef.current.click()} aria-label="Change photo"><Icon name="camera" size={18} /></button>}
          </>
        )}
        {sheet === 'draw' && <DrawTools value={drawing} onChange={setDrawing} onDone={() => setSheet(null)} />}
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files[0]) setFile(e.target.files[0]); e.target.value = ''; }} />

      <div className="sc-post">
        <button className={`sc-target ${target === 'story' ? 'on' : ''}`} onClick={() => (target === 'story' ? setSheet('audience') : setTarget('story'))}>
          <Avatar user={user} size={26} /><span className="lbl"><b>Your story</b><small>{a.icon} {audience === 'team' && team ? team.name : a.label}</small></span>
        </button>
        <button className={`sc-target close ${target === 'close' ? 'on' : ''}`} onClick={() => setTarget('close')}><span className="star">★</span> Close Friends</button>
        <button className="sc-go" onClick={post} disabled={busy || empty} aria-label="Post story">{busy ? <span className="mini-spin" /> : <Icon name="next" size={22} stroke={2.4} />}</button>
      </div>

      {sheet === 'mood' && <MoodSheet value={mood} onClose={() => setSheet(null)} onPick={(v) => { setMood(v); setSheet(null); }} />}
      {sheet === 'location' && <LocationSheet value={place} onMap={opts.show_on_map} setOnMap={(v) => setOpts({ ...opts, show_on_map: v })} privateStory={effectiveAudience === 'private'} onClose={() => setSheet(null)} onPick={(p) => { setPlace(p); saveRecent(p); setSheet(null); }} onRemove={() => { setPlace(null); setSheet(null); }} />}
      {sheet === 'more' && <MoreSheet work={work} onClose={() => setSheet(null)} onTool={(t) => setSheet(t)} onAnnouncement={() => addSticker({ type: 'announcement' })} />}
      {sheet === 'poll' && <StickerForm title="Poll" onClose={() => setSheet('more')} fields={[['question', 'Ask a question'], ['a', 'Option 1', 'Yes'], ['b', 'Option 2', 'No']]} onDone={(v) => addSticker({ type: 'poll', question: v.question, options: [v.a, v.b] })} />}
      {sheet === 'question' && <StickerForm title="Question" onClose={() => setSheet('more')} fields={[['prompt', 'Ask me anything', 'Ask me anything']]} onDone={(v) => addSticker({ type: 'question', prompt: v.prompt })} />}
      {sheet === 'countdown' && <StickerForm title="Countdown" onClose={() => setSheet('more')} fields={[['title', 'Countdown name', 'Team outing'], ['ends_at', 'Ends', '', 'datetime-local']]} onDone={(v) => addSticker({ type: 'countdown', title: v.title, ends_at: new Date(v.ends_at).toISOString() })} />}
      {sheet === 'link' && <StickerForm title="Link" onClose={() => setSheet('more')} fields={[['url', 'https://', ''], ['label', 'Label (optional)', '']]} onDone={(v) => addSticker({ type: 'link', url: v.url.trim(), label: v.label })} />}
      {sheet === 'hashtag' && <StickerForm title="Hashtag" onClose={() => setSheet('more')} fields={[['tag', '#hashtag', '']]} onDone={(v) => addSticker({ type: 'hashtag', tag: v.tag.replace(/^#/, '') })} />}
      {sheet === 'mention' && <MentionSheet onClose={() => setSheet('more')} onPick={(f) => addSticker({ type: 'mention', user_id: f.id, name: f.full_name })} />}
      {sheet === 'templates' && (
        <Sheet title="Backgrounds" onClose={() => setSheet(null)}>
          <p className="small muted" style={{ marginTop: 0 }}>Backgrounds for text and mood stories.</p>
          <div className="sc-templates">{THEMES.map((t) => <button key={t.key} className={theme === t.key && !fileUrl ? 'on' : ''} style={{ background: t.css }} onClick={() => { setTheme(t.key); setFile(null); setSheet(null); }}><span>{t.label}</span></button>)}</div>
        </Sheet>
      )}
      {sheet === 'caption' && <CaptionSheet value={text} team={team} work={work} onClose={() => setSheet(null)} onSave={(v) => { setText(v); setSheet(null); }} onMention={() => setSheet('mention')} onWorkTag={() => { setAudience('team'); setTarget('story'); }} />}
      {sheet === 'audience' && <AudienceSheet value={audience} team={team} onClose={() => setSheet(null)} onPick={(v) => { setAudience(v); if (v !== 'close_friends') setTarget('story'); setSheet(null); }} onEditClose={() => setSheet('close-list')} />}
      {sheet === 'close-list' && <CloseFriendsSheet onClose={() => setSheet('audience')} />}
      {sheet === 'settings' && <SettingsSheet opts={opts} setOpts={setOpts} audience={audience} team={team} onAudience={() => setSheet('audience')} onClose={() => setSheet(null)} />}
      {preview && <StoryViewer preview groups={[{ user, stories: [draft] }]} onClose={() => setPreview(false)} />}
    </div>
  );
}

function MoodSheet({ value, onPick, onClose }) {
  return (
    <Sheet title="How are you feeling?" onClose={onClose}>
      <div className="sc-moods">{MOODS.map((x) => <button key={x.key} className={value === x.key ? 'on' : ''} onClick={() => onPick(value === x.key ? null : x.key)}><span>{x.emoji}</span>{x.label}</button>)}</div>
      <p className="small muted" style={{ textAlign: 'center', marginBottom: 0 }}>Your mood shows as a badge on your story.</p>
    </Sheet>
  );
}

function LocationSheet({ value, onPick, onRemove, onClose, onMap, setOnMap, privateStory }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const recent = readRecent();
  const here = async () => {
    setBusy(true);
    try { const [lat, lng] = await currentPosition(); onPick(await api(`/map/reverse?lat=${lat}&lng=${lng}`)); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Location" onClose={onClose} footer={value && <button className="btn ghost block" onClick={onRemove}>Remove location</button>}>
      <label className="toggle-row"><span><b>📍 Add to Map Discovery</b><small>{privateStory ? 'Private stories never appear on the Map.' : 'Friends who can see this story can find it on the Map.'}</small></span><input type="checkbox" className="switch" checked={!!onMap && !privateStory} disabled={privateStory} onChange={(e) => setOnMap(e.target.checked)} /></label>
      <button className="place-row" onClick={here} disabled={busy}><span className="pin-ic blue"><Icon name="crosshair" size={17} /></span><span className="meta"><b>{busy ? 'Finding you…' : 'Current location'}</b><small>Uses your browser’s location</small></span></button>
      {recent.length > 0 && <div className="sc-label">Recent places</div>}
      {recent.map((p) => <button key={p.name} className="place-row" onClick={() => onPick(p)}><span className="pin-ic"><Icon name="clock" size={16} /></span><span className="meta"><b>{p.name}</b><small>{p.display || 'Recently used'}</small></span></button>)}
      <div className="sc-label">Search location</div>
      <PlaceSearch placeholder="Search a place, e.g. Cebu IT Park" onPick={onPick} />
    </Sheet>
  );
}

function MoreSheet({ work, onTool, onAnnouncement, onClose }) {
  const tools = [['poll', '📊', 'Poll'], ['question', '❓', 'Question'], ['countdown', '⏳', 'Countdown'], ['gif', '🎞️', 'GIF'], ['mention', '@', 'Mention'], ['link', '🔗', 'Link'],
    ['hashtag', '#', 'Hashtag'], ['announcement', '📣', 'Work Announcement']];
  return (
    <Sheet title="Stickers" onClose={onClose}>
      <div className="sc-more">
        {tools.map(([k, e, l]) => {
          const disabled = (k === 'announcement' && !work) || k === 'gif';
          return (
            <button key={k} disabled={disabled} onClick={() => (k === 'announcement' ? onAnnouncement() : onTool(k))}>
              <span className="e">{e}</span><span>{l}</span>
              {k === 'gif' && <small>Needs a GIF API key</small>}
              {k === 'announcement' && !work && <small>Team Only stories</small>}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

function StickerForm({ title, fields, onDone, onClose }) {
  const [v, setV] = useState(Object.fromEntries(fields.map(([k, , d = '']) => [k, d])));
  const ok = fields.every(([k, , , type]) => String(v[k]).trim() || k === 'label' || (type === undefined && false)) && fields.filter(([k]) => k !== 'label').every(([k]) => String(v[k]).trim());
  return (
    <Sheet title={title} onClose={onClose} footer={<button className="btn block" disabled={!ok} onClick={() => onDone(v)}>Add to story</button>}>
      {fields.map(([k, ph, , type]) => (
        <input key={k} className="input" style={{ marginBottom: 10 }} type={type || 'text'} placeholder={ph} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} maxLength={type ? undefined : 300} autoFocus={k === fields[0][0]} />
      ))}
    </Sheet>
  );
}

function MentionSheet({ onPick, onClose }) {
  const friends = useLoad(() => api('/friends'), []);
  const [q, setQ] = useState('');
  return (
    <Sheet title="Mention a friend" onClose={onClose}>
      <div className="search-bar sc-search"><Icon name="search" size={18} /><input placeholder="Search friends" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
      {(friends.data || []).filter((f) => f.full_name.toLowerCase().includes(q.toLowerCase())).slice(0, 30).map((f) => (
        <button key={f.id} className="row-item" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left' }} onClick={() => onPick(f)}><Avatar user={f} size={38} /><div className="meta"><div className="title">{f.full_name}</div></div></button>
      ))}
    </Sheet>
  );
}

function CaptionSheet({ value, team, work, onSave, onMention, onWorkTag, onClose }) {
  const [v, setV] = useState(value);
  const add = (s) => setV((x) => `${x}${x && !x.endsWith(' ') ? ' ' : ''}${s}`);
  const tags = ['#MoodToday', '#Weekend', '#Grateful', ...(team ? [`#${team.name.replace(/\s+/g, '')}`] : [])];
  return (
    <Sheet title="Tell your story" onClose={onClose} footer={<button className="btn block" onClick={() => onSave(v.trim())}>Done</button>}>
      <textarea className="input" rows={4} autoFocus placeholder="Tell your story..." value={v} maxLength={500} onChange={(e) => setV(e.target.value)} />
      <div className="sc-label">Hashtags</div>
      <div className="sc-chips">{tags.map((t) => <button key={t} onClick={() => add(t)}>{t}</button>)}</div>
      <div className="sc-label">Add</div>
      <div className="sc-chips">
        <button onClick={() => { onSave(v.trim()); onMention(); }}>@ Mention a friend</button>
        {team && <button className={work ? 'on' : ''} onClick={onWorkTag}>💼 Work tag · {team.name}</button>}
      </div>
    </Sheet>
  );
}

function AudienceSheet({ value, team, onPick, onEditClose, onClose }) {
  const close = useLoad(() => api('/close-friends'), []);
  return (
    <Sheet title="Story audience" onClose={onClose}>
      {Object.entries(AUDIENCE).map(([k, a]) => {
        const disabled = k === 'team' && !team;
        return (
          <button key={k} className={`choice-card ${value === k ? 'on' : ''}`} disabled={disabled} style={disabled ? { opacity: 0.5 } : undefined} onClick={() => onPick(k)}>
            <span style={{ fontSize: 22 }}>{a.icon}</span>
            <span><b>{k === 'team' && team ? `Team Only · ${team.name}` : a.label}</b><small>{disabled ? 'You aren’t on a team yet.' : k === 'close_friends' ? `${close.data?.length ?? '…'} people. ${a.sub}` : a.sub}</small></span>
            <span className="radio" />
          </button>
        );
      })}
      <button className="btn ghost block" onClick={onEditClose}>⭐ Edit Close Friends list</button>
    </Sheet>
  );
}

function CloseFriendsSheet({ onClose }) {
  const { toast } = useApp();
  const friends = useLoad(() => api('/friends'), []);
  const [ids, setIds] = useState(null);
  useEffect(() => { api('/close-friends').then(setIds); }, []);
  const save = async () => { await api('/close-friends', { method: 'PUT', body: { ids } }); toast('Close Friends updated', 'success'); onClose(); };
  return (
    <Sheet title="Close Friends" onClose={onClose} footer={<button className="btn block" disabled={!ids} onClick={save}>Save{ids ? ` (${ids.length})` : ''}</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>Only these people see stories you share to Close Friends. Nobody is notified when you change the list.</p>
      {!ids || !friends.data ? <Spinner /> : friends.data.map((f) => (
        <div key={f.id} className={`check-row ${ids.includes(f.id) ? 'on' : ''}`} onClick={() => setIds(ids.includes(f.id) ? ids.filter((x) => x !== f.id) : [...ids, f.id])}>
          <Avatar user={f} size={38} /><div style={{ flex: 1, fontWeight: 600 }}>{f.full_name}</div><span className="box"><Icon name="check" size={14} /></span>
        </div>
      ))}
    </Sheet>
  );
}

function SettingsSheet({ opts, setOpts, audience, team, onAudience, onClose }) {
  const T = ({ k, label, sub }) => (
    <label className="toggle-row"><span><b>{label}</b>{sub && <small>{sub}</small>}</span><input type="checkbox" className="switch" checked={!!opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} /></label>
  );
  const a = AUDIENCE[audience];
  return (
    <Sheet title="Story settings" onClose={onClose} footer={<button className="btn block" onClick={onClose}>Done</button>}>
      <button className="row-item sc-setting" onClick={onAudience}><span style={{ fontSize: 20 }}>{a.icon}</span><div className="meta"><div className="title">Story privacy</div><div className="sub">{audience === 'team' && team ? `Team Only · ${team.name}` : a.label}</div></div><Icon name="next" size={16} /></button>
      <T k="allow_replies" label="Allow replies" sub="Replies go to your private chat." />
      <T k="allow_reactions" label="Allow reactions" />
      <T k="allow_comments" label="Allow comments" sub="Public comments under your story." />
      <T k="allow_sharing" label="Allow sharing" sub="Viewers can send your story to a chat." />
      <T k="show_on_map" label="Show location on Map" sub="Only when you add a location." />
      <T k="archive" label="Save to archive" sub="Keep it in your story archive after it disappears." />
      <div className="sc-label">Story duration</div>
      <div className="seg">{[6, 12, 24].map((h) => <button key={h} className={opts.duration_hours === h ? 'active' : ''} onClick={() => setOpts({ ...opts, duration_hours: h })}>{h} hours</button>)}</div>
    </Sheet>
  );
}

/** Freehand drawing stored as normalised strokes; merged into the image when posting. */
function DrawLayer({ active, value, onChange }) {
  const ref = useRef(null);
  const color = useRef('#ffffff');
  const size = useRef(6);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const r = c.getBoundingClientRect(); c.width = r.width * 2; c.height = r.height * 2;
    const g = c.getContext('2d'); g.scale(2, 2); g.lineCap = 'round'; g.lineJoin = 'round';
    for (const s of value?.strokes || []) { g.strokeStyle = s.color; g.lineWidth = s.size; g.beginPath(); s.points.forEach(([x, y], k) => (k ? g.lineTo(x * r.width, y * r.height) : g.moveTo(x * r.width, y * r.height))); g.stroke(); }
  }, [value]);
  DrawLayer.setColor = (c) => { color.current = c; };
  DrawLayer.setSize = (s) => { size.current = s; };
  const down = (e) => {
    if (!active) return;
    const c = ref.current; const r = c.getBoundingClientRect();
    const pt = (ev) => [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height];
    const stroke = { color: color.current, size: size.current, points: [pt(e)] };
    const g = c.getContext('2d');
    c.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      const p = pt(ev); const last = stroke.points.at(-1); stroke.points.push(p);
      g.strokeStyle = stroke.color; g.lineWidth = stroke.size; g.beginPath(); g.moveTo(last[0] * r.width, last[1] * r.height); g.lineTo(p[0] * r.width, p[1] * r.height); g.stroke();
    };
    const up = () => { c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); onChange({ strokes: [...(value?.strokes || []), stroke] }); };
    c.addEventListener('pointermove', move); c.addEventListener('pointerup', up);
  };
  return <canvas ref={ref} className={`sc-draw ${active ? 'active' : ''}`} onPointerDown={down} />;
}
function DrawTools({ value, onChange, onDone }) {
  const [c, setC] = useState('#ffffff');
  const [s, setS] = useState(6);
  const COLORS = ['#ffffff', '#111111', '#5b8def', '#ff4d67', '#ffc83d', '#3ddc84'];
  return (
    <div className="sc-drawtools" onPointerDown={(e) => e.stopPropagation()}>
      {COLORS.map((x) => <button key={x} className={c === x ? 'on' : ''} style={{ background: x }} onClick={() => { setC(x); DrawLayer.setColor(x); }} aria-label={`Colour ${x}`} />)}
      <button className="sz" onClick={() => { const n = s === 6 ? 12 : s === 12 ? 3 : 6; setS(n); DrawLayer.setSize(n); }} aria-label="Brush size">{s === 3 ? 'S' : s === 6 ? 'M' : 'L'}</button>
      <button className="txt" disabled={!value?.strokes.length} onClick={() => onChange(value.strokes.length > 1 ? { strokes: value.strokes.slice(0, -1) } : null)}>Undo</button>
      <button className="txt done" onClick={onDone}>Done</button>
    </div>
  );
}
