import { useEffect, useRef, useState } from 'react';
import Icon from '@shared/Icon.jsx';
import { MOODS, THEMES, moodByKey, themeCss } from '@shared/constants.js';
import { api, toForm } from '../api.js';
import { useApp } from '../store.jsx';
import { Avatar, Sheet, Spinner, useLoad } from './ui.jsx';
import { PlaceSearch, currentPosition } from './Places.jsx';
import { StoryOverlays, STORY_EFFECTS, effectCss, mmss } from './StoryOverlays.jsx';
import { StoryViewer } from './Stories.jsx';

// Hunch story creation: Camera → Editor → Composer.
// 1. Camera opens immediately (gallery bottom-left, capture, switch camera) with quick templates.
// 2. Editor: the story preview with a short icon-only toolbar (Text, Mood, Location, Music, Effects, More).
// 3. Composer: everything in clear sections, then one POST STORY button.

export const AUDIENCE = {
  public: { icon: '🌎', label: 'Public', sub: 'Anyone on Hunch can view it.' },
  friends: { icon: '👥', label: 'Friends', sub: 'Only your friends.' },
  team: { icon: '💼', label: 'Team', sub: 'Only your work team. Also shows in the Work feed.' },
  private: { icon: '🔒', label: 'Private', sub: 'Only you. Kept in your archive.' },
};
const TEMPLATES = [
  { key: 'mood', icon: '😊', label: 'Mood Update', theme: 'sunset', ask: 'mood' },
  { key: 'location', icon: '📍', label: 'Current Location', theme: 'ocean', ask: 'location' },
  { key: 'work', icon: '💼', label: 'Work Update', theme: 'midnight', text: 'Work update: ', audience: 'team', team: true },
  { key: 'travel', icon: '✈️', label: 'Travel', theme: 'ocean', text: 'On the road ✈️ ', ask: 'location' },
  { key: 'event', icon: '🎉', label: 'Event', theme: 'sunset', text: '🎉 ' },
  { key: 'achievement', icon: '🏆', label: 'Achievement', theme: 'midnight', text: '🏆 Proud moment: ', mood: 'excited' },
  { key: 'question', icon: '❓', label: 'Question', theme: 'ocean', text: 'Question for you: ' },
];
const RECENT_PLACES = 'hunch_recent_places';
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_PLACES) || '[]'); } catch { return []; } };
const saveRecent = (p) => { try { localStorage.setItem(RECENT_PLACES, JSON.stringify([p, ...readRecent().filter((x) => x.name !== p.name)].slice(0, 5))); } catch { /* ignore */ } };

export default function StoryComposer({ onClose, onCreated }) {
  const { user, toast } = useApp();
  // Team stories go to the team you last opened in Work (only while Work Mode is on).
  const lastTeam = (() => { try { return localStorage.getItem('hunch_work_team') || ''; } catch { return ''; } })();
  const ctx = useLoad(() => (user.work_mode ? api(`/work/context${lastTeam ? `?team=${lastTeam}` : ''}`).catch(() => ({ team: null })) : Promise.resolve({ team: null })), []);
  const team = ctx.data?.team || null;
  const musicOn = useLoad(() => api('/music/status').catch(() => ({ enabled: false })), []).data?.enabled;
  const [step, setStep] = useState('camera'); // camera | edit | compose
  const [file, setFile] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [theme, setTheme] = useState('ocean');
  const [effect, setEffect] = useState(null);
  const [mood, setMood] = useState(null);
  const [text, setText] = useState('');
  const [place, setPlace] = useState(null);
  const [music, setMusic] = useState(null);
  const [audience, setAudience] = useState('friends');
  const [opts, setOpts] = useState({ allow_replies: true, allow_reactions: true, allow_comments: false, show_on_map: true, archive: true, duration_hours: 24 });
  const [sheet, setSheet] = useState(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const canvas = useRef(null);
  useEffect(() => { if (!file) { setFileUrl(null); return undefined; } const u = URL.createObjectURL(file); setFileUrl(u); return () => URL.revokeObjectURL(u); }, [file]);
  useEffect(() => {
    const k = (e) => { if (e.key !== 'Escape' || sheet || preview) return; if (step === 'compose') setStep('edit'); else if (step === 'edit') setStep('camera'); else onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [sheet, preview, step]);

  const pickMedia = (f) => { setFile(f); setEffect(null); setStep('edit'); };
  const applyTemplate = (t) => {
    setFile(null); setTheme(t.theme);
    if (t.text) setText(t.text);
    if (t.mood) setMood(t.mood);
    if (t.audience === 'team' && team) setAudience('team');
    setStep('edit');
    if (t.ask) setSheet(t.ask); else if (t.text) setSheet('caption');
  };
  const reset = () => { setFile(null); setText(''); setMood(null); setPlace(null); setMusic(null); setEffect(null); setStep('camera'); };

  const draft = {
    id: 'draft', user_id: user.id, image: fileUrl, effect, theme, mood, text, place_name: place?.name, show_on_map: place && opts.show_on_map && audience !== 'private',
    music, stickers: [], created_at: new Date().toISOString(), allow_replies: opts.allow_replies, allow_reactions: opts.allow_reactions, audience, team_name: team?.name,
  };
  const empty = !fileUrl && !mood && !text.trim();

  const post = async () => {
    setBusy(true);
    try {
      const fields = {
        image: file, text: text.trim(), mood, theme, audience, effect: fileUrl && effect ? effect : '',
        allow_replies: opts.allow_replies ? '1' : '0', allow_reactions: opts.allow_reactions ? '1' : '0', allow_comments: opts.allow_comments ? '1' : '0',
        show_on_map: opts.show_on_map && audience !== 'private' ? '1' : '0', archive: opts.archive || audience === 'private' ? '1' : '0',
        duration_hours: String(opts.duration_hours), ...(music ? { music: JSON.stringify(music) } : {}),
        ...(audience === 'team' && team ? { team_id: String(team.id) } : {}),
        ...(place ? { place_name: place.name, lat: String(place.lat), lng: String(place.lng) } : {}),
      };
      const s = await api('/stories', { method: 'POST', form: toForm(fields) });
      toast(audience === 'team' ? `Shared with ${team?.name || 'your team'}` : audience === 'private' ? 'Saved privately' : 'Story posted', 'success');
      onCreated?.(s); onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const sheets = (
    <>
      {sheet === 'caption' && <CaptionSheet value={text} onClose={() => setSheet(null)} onSave={(v) => { setText(v); setSheet(null); }} />}
      {sheet === 'mood' && <MoodSheet value={mood} onClose={() => setSheet(null)} onPick={(v) => { setMood(v); setSheet(null); }} />}
      {sheet === 'location' && <LocationSheet value={place} onMap={opts.show_on_map} setOnMap={(v) => setOpts({ ...opts, show_on_map: v })} privateStory={audience === 'private'}
        onClose={() => setSheet(null)} onPick={(p) => { setPlace(p); saveRecent(p); setSheet(null); }} onRemove={() => { setPlace(null); setSheet(null); }} />}
      {sheet === 'music' && <MusicSheet value={music} onClose={() => setSheet(null)} onPick={(m) => { setMusic(m); setSheet(null); }} onRemove={() => { setMusic(null); setSheet(null); }} />}
      {sheet === 'effects' && <EffectsSheet fileUrl={fileUrl} effect={effect} theme={theme} onEffect={setEffect} onTheme={setTheme} onClose={() => setSheet(null)} />}
      {sheet === 'more' && <MoreSheet opts={opts} setOpts={setOpts} hasPhoto={!!fileUrl} onRemovePhoto={() => { setFile(null); setSheet(null); }} onClear={() => { reset(); setSheet(null); }} onClose={() => setSheet(null)} />}
      {sheet === 'settings' && <AudienceSheet audience={audience} setAudience={setAudience} opts={opts} setOpts={setOpts} team={team} hasPlace={!!place} onClose={() => setSheet(null)} />}
      {preview && <StoryViewer preview groups={[{ user, stories: [draft] }]} onClose={() => setPreview(false)} />}
    </>
  );

  if (step === 'camera') {
    return (
      <div className="sc-screen hs" role="dialog" aria-modal="true" aria-label="Create story">
        <Camera team={team} onClose={onClose} onMedia={pickMedia} onTemplate={applyTemplate} />
        {sheets}
      </div>
    );
  }

  if (step === 'compose') {
    return (
      <div className="hs-compose" role="dialog" aria-modal="true" aria-label="Post story">
        <div className="hs-top solid">
          <button className="icon-btn" onClick={() => setStep('edit')} aria-label="Back to editor"><Icon name="back" /></button>
          <h2>New story</h2>
          <span style={{ width: 40 }} />
        </div>
        <div className="hs-sections">
          <section className="hs-sec hs-preview-sec">
            <button className="hs-thumb" onClick={() => setPreview(true)} aria-label="Preview story" style={{ background: fileUrl ? '#000' : themeCss(theme) }}>
              {fileUrl ? <img src={fileUrl} alt="" style={{ filter: effectCss(effect) }} /> : <span>{moodByKey(mood)?.emoji}<br />{text}</span>}
              <i><Icon name="eye" size={14} /> Preview</i>
            </button>
            <div className="hs-sum">
              <b>{AUDIENCE[audience].icon} {audience === 'team' && team ? team.name : AUDIENCE[audience].label}</b>
              <small>{AUDIENCE[audience].sub}</small>
              <small>Disappears after {opts.duration_hours} hours{opts.archive ? ' · saved to archive' : ''}</small>
            </div>
          </section>
          <section className="hs-sec">
            <h4>Caption</h4>
            <textarea className="input" rows={2} value={text} maxLength={500} placeholder="Tell your story..." onChange={(e) => setText(e.target.value)} />
          </section>
          <section className="hs-sec">
            <h4>😊 Mood</h4>
            <div className="hs-chiprow">
              {MOODS.map((x) => <button key={x.key} className={mood === x.key ? 'on' : ''} onClick={() => setMood(mood === x.key ? null : x.key)}>{x.emoji} {x.label}</button>)}
            </div>
          </section>
          <section className="hs-sec">
            <h4>📍 Location</h4>
            <button className="hs-pick" onClick={() => setSheet('location')}>
              {place ? <><b>{place.name}</b><small>{opts.show_on_map && audience !== 'private' ? 'Shown on Map Discovery' : 'Not on the Map'}</small></> : <span className="muted">Add a location</span>}
              <Icon name="next" size={16} />
            </button>
          </section>
          {(musicOn || music) && (
            <section className="hs-sec">
              <h4>🎵 Music</h4>
              <button className="hs-pick" onClick={() => setSheet('music')}>
                {music ? <><b>{music.title}</b><small>{music.artist} · {mmss(music.duration)}</small></> : <span className="muted">Add music</span>}
                <Icon name="next" size={16} />
              </button>
            </section>
          )}
          <section className="hs-sec">
            <h4>Audience</h4>
            <AudienceChoices audience={audience} setAudience={setAudience} team={team} />
            <Toggles opts={opts} setOpts={setOpts} hasPlace={!!place} audience={audience} />
          </section>
        </div>
        <div className="hs-postbar">
          <button className="hs-post" onClick={post} disabled={busy || empty}>{busy ? <span className="mini-spin" /> : 'POST STORY'}</button>
        </div>
        {sheets}
      </div>
    );
  }

  // Editor
  const tools = [
    ['caption', <span className="aa" key="a">Aa</span>, 'Text', !!text],
    ['mood', mood ? <span className="emo" key="m">{moodByKey(mood)?.emoji}</span> : <Icon name="smile" size={22} key="m" />, 'Mood', !!mood],
    ['location', <Icon name="location" size={22} key="l" />, 'Location', !!place],
    ...(musicOn ? [['music', <span className="emo" key="mu">🎵</span>, 'Music', !!music]] : []),
    ['effects', <Icon name="sparkle" size={21} key="e" />, 'Effects', !!effect],
    ['more', <Icon name="more" size={22} key="o" />, 'More', false],
  ];
  return (
    <div className="sc-screen hs" role="dialog" aria-modal="true" aria-label="Edit story">
      <div className="sc-canvas" ref={canvas} style={{ background: fileUrl ? '#000' : themeCss(theme) }}>
        {fileUrl ? <img className="sc-media" src={fileUrl} alt="" style={{ filter: effectCss(effect) }} /> : (
          <button className="hs-textstory" onClick={() => setSheet('caption')}>
            {mood && <span className="e">{moodByKey(mood)?.emoji}</span>}
            {text ? <span>{text}</span> : <span className="ph">Tap to write your story</span>}
          </button>
        )}
        <StoryOverlays s={fileUrl ? draft : { ...draft, mood: null }} containerRef={canvas} compact actions={{ onPiece: (k) => setSheet(k === 'caption' ? 'caption' : k) }} />
        <div className="hs-top">
          <button className="sc-float" onClick={() => setStep('camera')} aria-label="Back to camera"><Icon name="back" size={22} /></button>
          <button className="hs-title" onClick={() => setPreview(true)} disabled={empty}>Story Preview</button>
          <button className="sc-float" onClick={() => setSheet('settings')} aria-label="Story settings"><Icon name="settings" size={21} /></button>
        </div>
        <div className="hs-tools" role="toolbar" aria-label="Story tools">
          {tools.map(([k, icon, label, on]) => (
            <button key={k} className={`sc-float ${on ? 'on' : ''}`} onClick={() => setSheet(k)} aria-label={label} title={label}>{icon}</button>
          ))}
        </div>
      </div>
      <div className="hs-editbar">
        <span className="hs-aud"><Avatar user={user} size={26} /> {AUDIENCE[audience].icon} {audience === 'team' && team ? team.name : AUDIENCE[audience].label}</span>
        <button className="hs-next" onClick={() => setStep('compose')} disabled={empty}>Next <Icon name="next" size={18} /></button>
      </div>
      {sheets}
    </div>
  );
}

/** Live camera with gallery, capture and camera switch. Falls back to the gallery if the camera is blocked. */
function Camera({ team, onClose, onMedia, onTemplate }) {
  const video = useRef(null);
  const gallery = useRef(null);
  const stream = useRef(null);
  const [facing, setFacing] = useState('environment');
  const [state, setState] = useState('starting'); // starting | live | blocked | none
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setState('none'); return; }
      setState('starting');
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1080 }, height: { ideal: 1920 } }, audio: false });
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}); }
        setState('live');
      } catch (e) { setState(e?.name === 'NotAllowedError' ? 'blocked' : 'none'); }
    };
    start();
    return () => { cancelled = true; stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  }, [facing]);

  const capture = () => {
    const v = video.current;
    if (!v || state !== 'live' || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    const g = c.getContext('2d');
    if (facing === 'user') { g.translate(c.width, 0); g.scale(-1, 1); } // keep selfies as you saw them
    g.drawImage(v, 0, 0);
    setFlash(true); setTimeout(() => setFlash(false), 180);
    c.toBlob((b) => b && onMedia(new File([b], 'story.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.92);
  };

  const templates = TEMPLATES.filter((t) => !t.team || team);
  return (
    <div className="hs-camera">
      <div className="hs-viewfinder">
        <video ref={video} playsInline muted className={facing === 'user' ? 'mirror' : ''} style={{ opacity: state === 'live' ? 1 : 0 }} />
        {state !== 'live' && (
          <div className="hs-camstate">
            {state === 'starting' ? <Spinner /> : (
              <>
                <Icon name="camera" size={34} />
                <b>{state === 'blocked' ? 'Camera access is off' : 'No camera available'}</b>
                <small>{state === 'blocked' ? 'Allow camera access for Hunch in your browser settings, or pick a photo from your gallery.' : 'Pick a photo from your gallery or start from a template.'}</small>
                <button className="hs-pill" onClick={() => gallery.current.click()}><Icon name="image" size={17} /> Open gallery</button>
              </>
            )}
          </div>
        )}
        {flash && <div className="hs-flash" />}
        <button className="sc-float hs-x" onClick={onClose} aria-label="Close"><Icon name="close" size={22} /></button>
      </div>
      <div className="hs-templates" aria-label="Story templates">
        <button onClick={() => onTemplate({ key: 'text', theme: 'midnight' })}><span>Aa</span>Text</button>
        {templates.map((t) => <button key={t.key} onClick={() => onTemplate(t)}><span>{t.icon}</span>{t.label}</button>)}
      </div>
      <div className="hs-shutterbar">
        <button className="hs-side-btn" onClick={() => gallery.current.click()} aria-label="Gallery"><Icon name="image" size={22} /><small>Gallery</small></button>
        <button className="hs-shutter" onClick={capture} disabled={state !== 'live'} aria-label="Capture photo"><i /></button>
        <button className="hs-side-btn" onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')} disabled={state === 'none' || state === 'blocked'} aria-label="Switch camera"><Icon name="refresh" size={22} /><small>Switch</small></button>
      </div>
      <input ref={gallery} type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files[0]) onMedia(e.target.files[0]); e.target.value = ''; }} />
    </div>
  );
}

function CaptionSheet({ value, onSave, onClose }) {
  const [v, setV] = useState(value);
  return (
    <Sheet title="Caption" onClose={onClose} footer={<button className="btn block" onClick={() => onSave(v.trim())}>Done</button>}>
      <textarea className="input" rows={4} autoFocus placeholder="Tell your story..." value={v} maxLength={500} onChange={(e) => setV(e.target.value)} />
    </Sheet>
  );
}

function MoodSheet({ value, onPick, onClose }) {
  return (
    <Sheet title="How are you feeling?" onClose={onClose}>
      <div className="sc-moods">{MOODS.map((x) => <button key={x.key} className={value === x.key ? 'on' : ''} onClick={() => onPick(value === x.key ? null : x.key)}><span>{x.emoji}</span>{x.label}</button>)}</div>
      <p className="small muted" style={{ textAlign: 'center', marginBottom: 0 }}>Shows as “Feeling …” on your story.</p>
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
      <label className="toggle-row"><span><b>📍 Map Discovery</b><small>{privateStory ? 'Private stories never appear on the Map.' : 'People who can see this story can find it on the Hunch Map.'}</small></span><input type="checkbox" className="switch" checked={!!onMap && !privateStory} disabled={privateStory} onChange={(e) => setOnMap(e.target.checked)} /></label>
      <button className="place-row" onClick={here} disabled={busy}><span className="pin-ic blue"><Icon name="crosshair" size={17} /></span><span className="meta"><b>{busy ? 'Finding you…' : 'Current location'}</b><small>Uses your device location</small></span></button>
      {recent.length > 0 && <div className="sc-label">Recent places</div>}
      {recent.map((p) => <button key={p.name} className="place-row" onClick={() => onPick(p)}><span className="pin-ic"><Icon name="clock" size={16} /></span><span className="meta"><b>{p.name}</b><small>{p.display || 'Recently used'}</small></span></button>)}
      <div className="sc-label">Search location</div>
      <PlaceSearch placeholder="Search a place, e.g. Cebu IT Park" onPick={onPick} />
    </Sheet>
  );
}

/** Music from Freesound (searched through the Hunch API). Tap ▶ to listen, tap a track to use it. */
function MusicSheet({ value, onPick, onRemove, onClose }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [playing, setPlaying] = useState(null);
  const audio = useRef(null);
  const search = async (term) => {
    setRes(null);
    try { setRes(await api(`/music/search?q=${encodeURIComponent(term)}`)); } catch (e) { setRes({ error: e.message, tracks: [] }); }
  };
  useEffect(() => { search('chill'); return () => audio.current?.pause(); }, []);
  const listen = (t) => {
    if (playing === t.id) { audio.current.pause(); setPlaying(null); return; }
    audio.current.src = t.url; audio.current.play().catch(() => {}); setPlaying(t.id);
  };
  return (
    <Sheet title="Music" onClose={onClose} footer={value && <button className="btn ghost block" onClick={onRemove}>Remove music</button>}>
      <form className="search-bar sc-search" onSubmit={(e) => { e.preventDefault(); search(q || 'chill'); }}>
        <Icon name="search" size={18} /><input placeholder="Search music, e.g. night walk" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      <div className="hs-chiprow" style={{ margin: '10px 0' }}>{['Chill', 'Happy', 'Lo-fi', 'Acoustic', 'Upbeat', 'Piano'].map((g) => <button key={g} onClick={() => { setQ(g); search(g); }}>{g}</button>)}</div>
      <audio ref={audio} onEnded={() => setPlaying(null)} />
      {!res ? <Spinner /> : res.error ? <p className="small muted">{res.error}</p> : !res.tracks.length ? <p className="small muted">No tracks found.</p> : res.tracks.map((t) => (
        <div key={t.id} className={`hs-track ${value?.id === t.id ? 'on' : ''}`}>
          <button className="play" onClick={() => listen(t)} aria-label={playing === t.id ? 'Pause' : 'Play'}>{playing === t.id ? '❚❚' : '▶'}</button>
          <button className="meta" onClick={() => { audio.current.pause(); onPick({ id: t.id, title: t.title, artist: t.artist, url: t.url, duration: t.duration }); }}>
            <b>{t.title}</b><small>{t.artist} · {mmss(t.duration)}</small>
          </button>
        </div>
      ))}
      <p className="small muted" style={{ marginBottom: 0 }}>Music by Freesound creators.</p>
    </Sheet>
  );
}

function EffectsSheet({ fileUrl, effect, theme, onEffect, onTheme, onClose }) {
  return (
    <Sheet title={fileUrl ? 'Effects' : 'Background'} onClose={onClose} footer={<button className="btn block" onClick={onClose}>Done</button>}>
      {fileUrl ? (
        <div className="hs-effects">
          {STORY_EFFECTS.map((e) => (
            <button key={e.label} className={effect === e.key ? 'on' : ''} onClick={() => onEffect(e.key)}>
              <img src={fileUrl} alt="" style={{ filter: e.css }} /><span>{e.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="sc-templates">{THEMES.map((t) => <button key={t.key} className={theme === t.key ? 'on' : ''} style={{ background: t.css }} onClick={() => onTheme(t.key)}><span>{t.label}</span></button>)}</div>
      )}
    </Sheet>
  );
}

function MoreSheet({ opts, setOpts, hasPhoto, onRemovePhoto, onClear, onClose }) {
  return (
    <Sheet title="More" onClose={onClose} footer={<button className="btn block" onClick={onClose}>Done</button>}>
      <div className="sc-label" style={{ marginTop: 0 }}>Story duration</div>
      <div className="seg">{[6, 12, 24].map((h) => <button key={h} className={opts.duration_hours === h ? 'active' : ''} onClick={() => setOpts({ ...opts, duration_hours: h })}>{h} hours</button>)}</div>
      <label className="toggle-row"><span><b>Save to archive</b><small>Keep it in your story archive after it disappears.</small></span><input type="checkbox" className="switch" checked={!!opts.archive} onChange={(e) => setOpts({ ...opts, archive: e.target.checked })} /></label>
      {hasPhoto && <button className="btn ghost block" style={{ marginTop: 8 }} onClick={onRemovePhoto}>Use a background instead of the photo</button>}
      <button className="btn ghost block" style={{ marginTop: 8 }} onClick={onClear}>Start over</button>
    </Sheet>
  );
}

function AudienceChoices({ audience, setAudience, team }) {
  return (
    <div className="hs-aud-grid" role="radiogroup" aria-label="Story visibility">
      {Object.entries(AUDIENCE).map(([k, a]) => {
        const disabled = k === 'team' && !team;
        return (
          <button key={k} role="radio" aria-checked={audience === k} className={audience === k ? 'on' : ''} disabled={disabled} onClick={() => setAudience(k)}>
            <span className="i">{a.icon}</span><b>{k === 'team' && team ? team.name : a.label}</b><small>{disabled ? 'Not on a team' : a.sub}</small>
          </button>
        );
      })}
    </div>
  );
}

function Toggles({ opts, setOpts, hasPlace, audience }) {
  const T = ({ k, label, sub, disabled }) => (
    <label className="toggle-row"><span><b>{label}</b>{sub && <small>{sub}</small>}</span><input type="checkbox" className="switch" checked={!!opts[k] && !disabled} disabled={disabled} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} /></label>
  );
  return (
    <div className="hs-toggles">
      <T k="allow_replies" label="Allow replies" sub="Replies go to your private chat." />
      <T k="allow_reactions" label="Allow reactions" />
      <T k="allow_comments" label="Allow comments" sub="Comments under your story." />
      <T k="show_on_map" label="Allow Map Discovery" sub={audience === 'private' ? 'Private stories never appear on the Map.' : hasPlace ? 'Your story appears at its location on the Map.' : 'Add a location to use this.'} disabled={audience === 'private' || !hasPlace} />
    </div>
  );
}

function AudienceSheet({ audience, setAudience, opts, setOpts, team, hasPlace, onClose }) {
  return (
    <Sheet title="Story settings" onClose={onClose} footer={<button className="btn block" onClick={onClose}>Done</button>}>
      <div className="sc-label" style={{ marginTop: 0 }}>Visibility</div>
      <AudienceChoices audience={audience} setAudience={setAudience} team={team} />
      <Toggles opts={opts} setOpts={setOpts} hasPlace={hasPlace} audience={audience} />
    </Sheet>
  );
}
