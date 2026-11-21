import { useEffect, useRef, useState } from 'react';
import Icon from '@shared/Icon.jsx';
import { moodByKey, themeCss } from '@shared/constants.js';
import { api, toForm } from '../api.js';
import { useApp } from '../store.jsx';
import { Avatar, Sheet, FilePreviews, MoodPicker, ThemePicker, timeAgo, Spinner, Confirm } from './ui.jsx';
import { LocationTagSheet } from './Places.jsx';
import { ShareSheet } from './Post.jsx';
import { StoryOverlays } from './StoryOverlays.jsx';
import { useNavigate } from 'react-router-dom';

export function StoryBar({ groups, onOpen, onCreate }) {
  const { user } = useApp();
  const mine = groups.find((g) => g.user.id === user.id);
  return (
    <div className="stories">
      <button className="story-card add" onClick={mine ? () => onOpen(groups.indexOf(mine)) : onCreate} aria-label="Your Mood Story">
        {mine ? <StoryThumb s={mine.stories.at(-1)} /> : <span className="plus"><Icon name="plus" size={20} /></span>}
        {mine && <span className="shade" />}
        <span className="name" style={mine ? { color: '#fff' } : undefined}>Your Mood Story</span>
        {mine && <span onClick={(e) => { e.stopPropagation(); onCreate(); }} style={{ position: 'absolute', right: 6, top: 6, width: 22, height: 22, borderRadius: 11, background: 'var(--primary)', display: 'grid', placeItems: 'center' }}><Icon name="plus" size={14} /></span>}
      </button>
      {groups.filter((g) => g.user.id !== user.id).map((g) => (
        <button key={g.user.id} className={`story-card ${g.allSeen ? '' : 'unseen'}`} onClick={() => onOpen(groups.indexOf(g))}>
          <StoryThumb s={g.stories.at(-1)} />
          <span className="shade" />
          <span className="name">{g.user.full_name.split(' ')[0]}</span>
          {g.stories.at(-1).mood && <span className="mood-chip">{moodByKey(g.stories.at(-1).mood)?.emoji}</span>}
        </button>
      ))}
    </div>
  );
}

function StoryThumb({ s }) {
  if (s.image) return <img className="bg" src={s.image} alt="" />;
  return <span className="bgfill" style={{ background: themeCss(s.theme) }}>{moodByKey(s.mood)?.emoji || ''}</span>;
}

export function StoryCreator({ onClose, onCreated }) {
  const { toast } = useApp();
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const [mood, setMood] = useState(null);
  const [theme, setTheme] = useState('ocean');
  const [allowComments, setAllowComments] = useState(false);
  const [place, setPlace] = useState(null);
  const [tagging, setTagging] = useState(false);
  const [busy, setBusy] = useState(false);
  const { prefs } = useApp();
  const ref = useRef();
  const submit = async () => {
    setBusy(true);
    try {
      const s = await api('/stories', { method: 'POST', form: toForm({ image: file, text, mood, theme, allow_comments: allowComments ? '1' : '0', ...(place ? { place_name: place.name, lat: String(place.lat), lng: String(place.lng) } : {}) }) });
      toast('Mood Story shared for 24 hours', 'success');
      onCreated(s);
      onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const m = moodByKey(mood);
  return (
    <Sheet title="New Mood Story" onClose={onClose}
      footer={<button className="btn block" disabled={busy || (!file && !text.trim() && !mood)} onClick={submit}>{busy ? 'Sharing…' : 'Share to Mood Story'}</button>}>
      <div style={{ position: 'relative', height: 220, borderRadius: 18, overflow: 'hidden', background: themeCss(theme), color: '#fff', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        {file ? <FileBg file={file} /> : null}
        <div style={{ position: 'relative', padding: 16 }}>
          {!file && m && <div style={{ fontSize: 48 }}>{m.emoji}</div>}
          <div style={{ fontWeight: 800, fontSize: 19, textShadow: '0 1px 6px rgba(0,0,0,.5)' }}>{text || (!file && !m ? 'Your story preview' : '')}</div>
          {m && <div className="story-mood">{m.emoji} Feeling {m.label.toLowerCase()}</div>}
        </div>
        {place && <div className="story-place">📍 {place.name}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn ghost sm" onClick={() => ref.current.click()}><Icon name="camera" size={18} /> {file ? 'Change photo' : 'Add photo'}</button>
        {file && <button className="btn ghost sm" onClick={() => setFile(null)}>Remove photo</button>}
        {place ? <button className="btn ghost sm" onClick={() => setPlace(null)} title="Remove location"><Icon name="location" size={17} /> {place.name.length > 18 ? place.name.slice(0, 17) + '…' : place.name} <Icon name="close" size={14} /></button>
          : <button className="btn ghost sm" onClick={() => setTagging(true)}><Icon name="location" size={17} /> Location</button>}
      </div>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => { setFile(e.target.files[0] || null); e.target.value = ''; }} />
      <label className="label">Text</label>
      <input className="input" maxLength={200} placeholder="Say something…" value={text} onChange={(e) => setText(e.target.value)} />
      <label className="label">Mood</label>
      <MoodPicker value={mood} onChange={setMood} />
      {!file && <><label className="label">Background theme</label><ThemePicker value={theme} onChange={setTheme} /></>}
      <label className="toggle-row"><span><b>Allow comments</b><small>Friends who see this story can leave public comments.</small></span><input type="checkbox" className="switch" checked={allowComments} onChange={(e) => setAllowComments(e.target.checked)} /></label>
      {tagging && <LocationTagSheet sharing={prefs?.location_sharing} onPick={setPlace} onClose={() => setTagging(false)} />}
    </Sheet>
  );
}

function FileBg({ file }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return <img src={url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />;
}

const REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👏'];
const DURATION = 5500;

/** Full-screen viewer. groups: [{user, stories}] */
export function StoryViewer({ groups, startGroup = 0, onClose, onChanged, title, highlight: hl0, onManage, preview }) {
  const { user, toast } = useApp();
  const navTo = useNavigate();
  const stage = useRef(null);
  const [gi, setGi] = useState(startGroup);
  const [si, setSi] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [panel, setPanel] = useState(null); // 'viewers' | 'highlight' | 'delete' | 'comments' | 'reactions'
  const [reply, setReply] = useState('');
  const [typing, setTyping] = useState(false);
  const [, force] = useState(0);
  const group = groups[gi];
  const story = group?.stories[si];
  const mine = group?.user.id === user.id;
  const [hl, setHl] = useState(hl0 || null);
  useEffect(() => { if (hl0 && !mine) api(`/highlights/${hl0.id}/view`, { method: 'POST' }).catch(() => {}); }, [hl0?.id]);
  const likeHl = async () => {
    const r = await api(`/highlights/${hl.id}/like`, { method: 'POST' });
    setHl((h) => ({ ...h, ...r }));
  };

  useEffect(() => {
    if (story && !mine && !hl0 && !preview) api(`/stories/${story.id}/view`, { method: 'POST' }).catch(() => {});
    setProgress(0);
  }, [story?.id]);
  const dur = DURATION;
  const stickerActions = preview || mine ? null : {
    onPoll: async (option) => { try { const p = await api(`/stories/${story.id}/poll`, { method: 'POST', body: { option } }); story.stickers = story.stickers.map((x) => (x.type === 'poll' ? p : x)); force((n) => n + 1); } catch (e) { toast(e.message, 'error'); } },
    onAnswer: async (text) => { try { await api(`/stories/${story.id}/answer`, { method: 'POST', body: { text } }); toast('Answer sent', 'success'); } catch (e) { toast(e.message, 'error'); } },
    onMention: (uid) => { onClose(); navTo(`/u/${uid}`); },
    onFocus: () => setTyping(true), onBlur: () => setTyping(false),
  };

  const next = () => {
    if (si < group.stories.length - 1) setSi(si + 1);
    else if (gi < groups.length - 1) { setGi(gi + 1); setSi(0); } else onClose();
  };
  const prev = () => {
    if (si > 0) setSi(si - 1);
    else if (gi > 0) { setGi(gi - 1); setSi(groups[gi - 1].stories.length - 1); }
  };

  useEffect(() => {
    if (paused || panel || typing || !story) return undefined;
    const started = Date.now() - progress * dur;
    const id = setInterval(() => {
      const p = (Date.now() - started) / dur;
      if (p >= 1) { clearInterval(id); next(); } else setProgress(p);
    }, 50);
    return () => clearInterval(id);
  }, [paused, panel, typing, story?.id, gi, si]);

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') prev(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  if (!story) return null;
  const m = moodByKey(story.mood);
  const react = async (emoji) => {
    try {
      if (story.my_reaction === emoji) {
        await api(`/stories/${story.id}/react`, { method: 'DELETE' });
        story.my_reaction = null;
      } else {
        await api(`/stories/${story.id}/react`, { method: 'POST', body: { emoji } });
        story.my_reaction = emoji;
        toast(emoji === '❤️' ? 'Liked' : `Reacted ${emoji}`);
      }
      setPanel(null);
      force((n) => n + 1);
    } catch (e) { toast(e.message, 'error'); }
  };
  // Direct story messaging: the reply lands in your private chat with the owner.
  const sendReply = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    try {
      await api(`/stories/${story.id}/reply`, { method: 'POST', body: { text: reply } });
      setReply('');
      toast('Sent to chat', 'success');
    } catch (ex) { toast(ex.message, 'error'); }
  };

  return (
    <div className="story-viewer">
      <div className="story-stage" onMouseDown={() => setPaused(true)} onMouseUp={() => setPaused(false)} onTouchStart={() => setPaused(true)} onTouchEnd={() => setPaused(false)}>
        <div className="story-content" style={{ background: story.image ? '#000' : themeCss(story.theme) }}>
          {story.image ? <img src={story.image} alt="" /> : (
            <div>
              {m && <div style={{ fontSize: 80 }}>{m.emoji}</div>}
              {story.text && <div className="story-text-only">{story.text}</div>}
            </div>
          )}
        </div>
        <div className="story-overlay-box" ref={stage}>
          <StoryOverlays s={story} containerRef={stage} actions={stickerActions} />
        </div>
        <div className="story-bars">
          {group.stories.map((s, i) => <div key={s.id}><i style={{ width: `${i < si ? 100 : i === si ? progress * 100 : 0}%` }} /></div>)}
        </div>
        <div className="story-top">
          <Avatar user={group.user} size={34} />
          <div style={{ flex: 1 }}>
            <div className="name">{title || group.user.full_name}</div>
            <div className="time">{preview ? 'Preview' : timeAgo(story.created_at)}{title ? ` · ${group.user.full_name}` : ''}
              {story.audience === 'close_friends' && <span className="aud-badge close">★ Close Friends</span>}
              {story.audience === 'team' && <span className="aud-badge team">💼 {story.team_name || 'Team'}</span>}
              {story.audience === 'private' && <span className="aud-badge">🔒 Only you</span>}</div>
          </div>
          {mine && !preview && <button className="icon-btn" style={{ color: '#fff' }} onClick={(e) => { e.stopPropagation(); setPanel('menu'); }} aria-label="Story options"><Icon name="more" /></button>}
          <button className="icon-btn" style={{ color: '#fff' }} onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <button className="story-tap" style={{ left: 0 }} onClick={prev} aria-label="Previous" />
        <button className="story-tap" style={{ right: 0 }} onClick={next} aria-label="Next" />
        <div className="story-bottom" onMouseDown={(e) => e.stopPropagation()}>
          {hl ? (
            <div className="hl-bar">
              <button className={`hl-act ${hl.liked ? 'liked' : ''}`} onClick={likeHl} aria-label="Like highlight"><Icon name="heart" size={23} fill={hl.liked ? 'currentColor' : 'none'} /><span>{hl.likes}</span></button>
              <button className="hl-act" onClick={() => setPanel('hl-comments')} aria-label="Highlight comments"><Icon name="comment" size={22} /><span>{hl.comments}</span></button>
              <button className="hl-act" onClick={() => setPanel('hl-share')} aria-label="Share highlight"><Icon name="send" size={22} /><span>Share</span></button>
              {mine && <button className="hl-act" onClick={() => setPanel('hl-stats')} aria-label="Highlight statistics"><Icon name="chart" size={22} /><span>Stats</span></button>}
              {mine && onManage && <button className="hl-act" onClick={onManage} aria-label="Edit highlight"><Icon name="edit" size={21} /><span>Edit</span></button>}
            </div>
          ) : preview ? (
            <div className="story-preview-note">This is how your story will look. Close to keep editing.</div>
          ) : mine ? (
            <>
              <button className="story-chip" onClick={() => setPanel('viewers')}><Icon name="eye" size={17} /> {story.view_count ?? 0}</button>
              <button className="story-chip" onClick={() => setPanel('viewers')}><Icon name="heart" size={17} /> {story.like_count ?? 0}</button>
              {!!story.allow_comments && <button className="story-chip" onClick={() => setPanel('comments')}><Icon name="comment" size={17} /> {story.comment_count}</button>}
            </>
          ) : (
            <form className="story-reply" onSubmit={sendReply}>
              {story.allow_replies === 0 ? <span className="story-noreply">Replies are off</span> : <input value={reply} onChange={(e) => setReply(e.target.value)} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)}
                placeholder={`Reply to ${group.user.full_name.split(' ')[0]}…`} aria-label="Reply to story" maxLength={1000} />}
              {reply.trim() ? <button className="r-btn" aria-label="Send reply"><Icon name="send" size={22} /></button> : (
                <>
                  {story.allow_reactions !== 0 && <button type="button" className={`r-btn ${story.my_reaction === '❤️' ? 'liked' : ''}`} onClick={() => react('❤️')} aria-label="Like story">
                    <Icon name="heart" size={24} fill={story.my_reaction === '❤️' ? 'currentColor' : 'none'} />
                  </button>}
                  {story.allow_reactions !== 0 && <button type="button" className="r-btn" onClick={() => setPanel('reactions')} aria-label="Quick reactions">
                    {story.my_reaction && story.my_reaction !== '❤️' ? <span style={{ fontSize: 22 }}>{story.my_reaction}</span> : <Icon name="smile" size={24} />}
                  </button>}
                  {story.allow_sharing !== 0 && <button type="button" className="r-btn" onClick={() => setPanel('share')} aria-label="Share story"><Icon name="send" size={22} /></button>}
                  {!!story.allow_comments && <button type="button" className="r-btn" onClick={() => setPanel('comments')} aria-label="Comments"><Icon name="comment" size={23} />{story.comment_count ? <small>{story.comment_count}</small> : null}</button>}
                </>
              )}
            </form>
          )}
        </div>
      </div>
      {panel === 'menu' && (
        <Sheet title="" onClose={() => setPanel(null)}>
          <div className="menu-list">
            <button onClick={() => setPanel('viewers')}><Icon name="eye" /> Viewers & reactions</button>
            <button onClick={() => setPanel('highlight')}><Icon name="star" /> Add to highlight</button>
            <button onClick={async () => { const s2 = await api(`/stories/${story.id}`, { method: 'PATCH', body: { allow_comments: !story.allow_comments } }); story.allow_comments = s2.allow_comments; setPanel(null); toast(s2.allow_comments ? 'Comments allowed' : 'Comments disabled'); }}><Icon name="comment" /> {story.allow_comments ? 'Disable comments' : 'Allow comments'}</button>
            <button className="danger" onClick={() => setPanel('delete')}><Icon name="trash" /> Delete story</button>
          </div>
        </Sheet>
      )}
      {panel === 'reactions' && (
        <Sheet title="Quick reaction" onClose={() => setPanel(null)}>
          <div className="react-bar">{REACTIONS.map((r) => <button key={r} className={story.my_reaction === r ? 'active' : ''} onClick={() => react(r)}>{r}</button>)}</div>
        </Sheet>
      )}
      {panel === 'comments' && <StoryComments story={story} mine={mine} onClose={() => setPanel(null)} onCount={(n) => { story.comment_count = n; force((x) => x + 1); }} />}
      {panel === 'hl-comments' && <HighlightComments hl={hl} mine={mine} onClose={() => setPanel(null)} onCount={(n) => setHl((h) => ({ ...h, comments: n }))} />}
      {panel === 'hl-share' && <ShareSheet endpoint={`/highlights/${hl.id}/share`} onClose={() => setPanel(null)}
        onCopy={async () => { try { await navigator.clipboard.writeText(`${location.origin}/u/${hl.user_id}?highlight=${hl.id}`); toast('Link copied'); } catch { toast('Could not copy link', 'error'); } }} />}
      {panel === 'hl-stats' && <HighlightStats hl={hl} onClose={() => setPanel(null)} />}
      {panel === 'share' && <ShareSheet endpoint={`/stories/${story.id}/share`} onClose={() => setPanel(null)} onCopy={() => { toast('Stories can be shared to chats'); }} />}
      {panel === 'viewers' && <ViewersSheet storyId={story.id} onClose={() => setPanel(null)} />}
      {panel === 'highlight' && <AddToHighlight storyIds={[story.id]} onClose={() => setPanel(null)} onDone={onChanged} />}
      {panel === 'delete' && (
        <Confirm title="Delete this story?" message="It will also be removed from any highlights." danger confirmLabel="Delete" onClose={() => setPanel(null)}
          onConfirm={async () => { await api(`/stories/${story.id}`, { method: 'DELETE' }); onChanged?.(); onClose(); }} />
      )}
    </div>
  );
}

function StoryComments({ story, mine, onClose, onCount }) {
  const { toast } = useApp();
  const [list, setList] = useState(null);
  const [text, setText] = useState('');
  useEffect(() => { api(`/stories/${story.id}/comments`).then(setList); }, [story.id]);
  const send = async (e) => {
    e.preventDefault();
    try {
      const c = await api(`/stories/${story.id}/comments`, { method: 'POST', body: { text } });
      setList((l) => [...l, c]); onCount((list?.length || 0) + 1); setText('');
    } catch (ex) { toast(ex.message, 'error'); }
  };
  return (
    <Sheet title="Story comments" onClose={onClose}
      footer={<form onSubmit={send} style={{ display: 'flex', gap: 8 }}><input className="input" placeholder={mine ? 'Reply to comments…' : 'Add a public comment…'} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} /><button className="btn" disabled={!text.trim()}>Post</button></form>}>
      {!list ? <Spinner /> : !list.length ? <p className="muted">No comments yet. Comments here are visible to everyone who can see this story.</p> : list.map((c) => (
        <div key={c.id} className="row-item" style={{ alignItems: 'flex-start' }}>
          <Avatar user={c.author} size={34} />
          <div className="meta"><div className="title" style={{ fontSize: 13.5 }}>{c.author.full_name} <span className="muted small" style={{ fontWeight: 500 }}>{timeAgo(c.created_at)}</span></div><div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{c.text}</div></div>
        </div>
      ))}
    </Sheet>
  );
}

function HighlightComments({ hl, mine, onClose, onCount }) {
  const { toast, user } = useApp();
  const [list, setList] = useState(null);
  const [text, setText] = useState('');
  useEffect(() => { api(`/highlights/${hl.id}/comments`).then(setList); }, [hl.id]);
  const send = async (e) => {
    e.preventDefault();
    try {
      const c = await api(`/highlights/${hl.id}/comments`, { method: 'POST', body: { text } });
      const next = [...list, c]; setList(next); onCount(next.length); setText('');
    } catch (ex) { toast(ex.message, 'error'); }
  };
  const del = async (c) => { await api(`/highlights/${hl.id}/comments/${c.id}`, { method: 'DELETE' }); const next = list.filter((x) => x.id !== c.id); setList(next); onCount(next.length); };
  return (
    <Sheet title={`Comments · ${hl.title}`} onClose={onClose}
      footer={<form onSubmit={send} style={{ display: 'flex', gap: 8 }}><input className="input" placeholder="Add a comment…" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} /><button className="btn" disabled={!text.trim()}>Post</button></form>}>
      {!list ? <Spinner /> : !list.length ? <p className="muted">No comments yet. Be the first.</p> : list.map((c) => (
        <div key={c.id} className="row-item" style={{ alignItems: 'flex-start' }}>
          <Avatar user={c.author} size={34} />
          <div className="meta"><div className="title" style={{ fontSize: 13.5 }}>{c.author.full_name} <span className="muted small" style={{ fontWeight: 500 }}>{timeAgo(c.created_at)}</span></div><div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{c.text}</div></div>
          {(mine || c.user_id === user.id) && <button className="icon-btn" onClick={() => del(c)} aria-label="Delete comment"><Icon name="trash" size={16} /></button>}
        </div>
      ))}
    </Sheet>
  );
}

function HighlightStats({ hl, onClose }) {
  const [s, setS] = useState(null);
  useEffect(() => { api(`/highlights/${hl.id}/stats`).then(setS); }, [hl.id]);
  return (
    <Sheet title={`Statistics · ${hl.title}`} onClose={onClose}>
      {!s ? <Spinner /> : (
        <>
          <div className="hl-stats">
            {[['eye', 'Views', s.views], ['users', 'Viewers', s.viewers], ['heart', 'Likes', s.likes], ['comment', 'Comments', s.comments], ['send', 'Shares', s.shares], ['sparkle', 'Stories', `${s.stories}/${s.max}`]].map(([i, k, v]) => (
              <div key={k}><Icon name={i} size={16} /><b>{v}</b><small>{k}</small></div>
            ))}
          </div>
          <div className="section-title">Recent viewers</div>
          {!s.recentViewers.length ? <p className="small muted">No one has viewed this highlight yet.</p> : s.recentViewers.map((v) => (
            <div key={v.user_id} className="row-item">
              <Avatar user={v.user} size={36} />
              <div className="meta"><div className="title">{v.user.full_name}</div><div className="sub">{v.views} {v.views === 1 ? 'view' : 'views'} · {timeAgo(v.last_viewed_at)} ago</div></div>
              {s.likers.some((l) => l.id === v.user_id) && <Icon name="heart" size={18} fill="currentColor" style={{ color: 'var(--danger)' }} />}
            </div>
          ))}
        </>
      )}
    </Sheet>
  );
}

function ViewersSheet({ storyId, onClose }) {
  const [list, setList] = useState(null);
  useEffect(() => { api(`/stories/${storyId}/viewers`).then(setList); }, [storyId]);
  return (
    <Sheet title="Viewers" onClose={onClose}>
      {!list ? <Spinner /> : !list.length ? <p className="muted">No views yet.</p> : list.map((v) => (
        <div key={v.user_id} className="row-item">
          <Avatar user={v.user} size={36} />
          <div className="meta"><div className="title">{v.user.full_name}</div><div className="sub">{timeAgo(v.created_at)}</div></div>
          <span style={{ fontSize: 22 }}>{v.reaction}</span>
        </div>
      ))}
    </Sheet>
  );
}

export function AddToHighlight({ storyIds, onClose, onDone }) {
  const { user, toast } = useApp();
  const [list, setList] = useState(null);
  const [title, setTitle] = useState('');
  useEffect(() => { api(`/users/${user.id}/highlights`).then(setList); }, [user.id]);
  const addTo = async (hl) => {
    await api(`/highlights/${hl.id}`, { method: 'PATCH', body: { addStoryIds: storyIds } });
    toast(`Added to "${hl.title}"`, 'success');
    onDone?.();
    onClose();
  };
  const create = async () => {
    try {
      await api('/highlights', { method: 'POST', body: { title, storyIds } });
      toast('Highlight created', 'success');
      onDone?.();
      onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Sheet title="Add to highlight" onClose={onClose}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="input" placeholder="New highlight name" maxLength={40} value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn" disabled={!title.trim()} onClick={create}>Create</button>
      </div>
      {list?.length > 0 && <div className="section-title">Existing</div>}
      {list?.map((hl) => (
        <button key={hl.id} className="row-item" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left' }} onClick={() => addTo(hl)}>
          <div className="avatar" style={{ width: 40, height: 40, background: hl.cover ? undefined : themeCss(hl.coverTheme) }}>{hl.cover ? <img src={hl.cover} alt="" /> : moodByKey(hl.coverMood)?.emoji}</div>
          <div className="meta"><div className="title">{hl.title}</div><div className="sub">{hl.stories.length} stories</div></div>
          <Icon name="plus" />
        </button>
      ))}
    </Sheet>
  );
}
