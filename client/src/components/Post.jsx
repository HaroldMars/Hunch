import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { api, toForm } from '../api.js';
import { useApp } from '../store.jsx';
import { Avatar, Sheet, Confirm, FilePreviews, Lightbox, Spinner, Empty, timeAgo, useLoad } from './ui.jsx';
import { usePhotoEditing } from './ImageEditor.jsx';

export function ImageGrid({ images, onOpen }) {
  const { prefs } = useApp();
  const [load, setLoad] = useState(false);
  if (!images?.length) return null;
  // Data & Storage → "Load media automatically" off: show a tap-to-load placeholder.
  if (prefs && prefs.media_autoload === false && !load) {
    return <button className="media-placeholder" onClick={() => setLoad(true)}><Icon name="image" size={20} /> Tap to load {images.length} photo{images.length > 1 ? 's' : ''}</button>;
  }
  const shown = images.slice(0, 4);
  return (
    <div className={`images n${shown.length}`}>
      {shown.map((src, i) => (
        <div key={src} className={i === 3 && images.length > 4 ? 'more' : ''} data-more={`+${images.length - 4}`}>
          <img src={src} alt="" loading="lazy" onClick={() => onOpen(src)} />
        </div>
      ))}
    </div>
  );
}

function PostInner({ post, onOpenImage }) {
  return (
    <>
      {post.text && <div className="post-text">{post.text}</div>}
      <ImageGrid images={post.images} onOpen={onOpenImage} />
    </>
  );
}

/** detail: the post is shown on its own Thread page (comments below it). */
export function PostCard({ post: initial, onDeleted, detail, onComment, canManage }) {
  const { user, toast } = useApp();
  const nav = useNavigate();
  const [post, setPost] = useState(initial);
  const [img, setImg] = useState(null);
  const [sheet, setSheet] = useState(null); // 'comments' | 'share' | 'menu' | 'delete'
  const target = post.repost_of && post.original && !post.original.unavailable ? post.original : post;

  const like = async () => {
    const optimistic = { liked: !target.liked, likes: target.likes + (target.liked ? -1 : 1) };
    update(optimistic);
    try { update(await api(`/posts/${target.id}/like`, { method: 'POST' })); } catch (e) { toast(e.message, 'error'); }
  };
  const repost = async () => {
    try {
      const r = await api(`/posts/${target.id}/repost`, { method: 'POST' });
      update(r);
      toast(r.reposted ? 'Reposted to your timeline' : 'Repost removed');
    } catch (e) { toast(e.message, 'error'); }
  };
  function update(patch) {
    setPost((p) => (p.repost_of && p.original ? { ...p, original: { ...p.original, ...patch } } : { ...p, ...patch }));
  }
  const save = async () => {
    try { const r = await api(`/posts/${target.id}/save`, { method: 'POST' }); update(r); toast(r.saved ? 'Saved. Find it in Profile → Saved' : 'Removed from saved'); } catch (e) { toast(e.message, 'error'); }
    setSheet(null);
  };
  const pin = async () => {
    try { const r = await api(`/work/posts/${post.id}/pin`, { method: 'POST' }); update(r); toast(r.pinned ? 'Pinned to the top of the Work feed' : 'Unpinned'); } catch (e) { toast(e.message, 'error'); }
    setSheet(null);
  };
  const work = !!post.team_id;
  const openThread = () => (detail ? onComment?.() : nav(`/post/${target.id}`));
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`${location.origin}/post/${target.id}`); toast('Link copied'); } catch { toast('Could not copy link', 'error'); }
    setSheet(null);
  };

  return (
    <article className={`post ${detail ? 'detail' : ''} ${post.kind === 'announcement' ? 'announce' : ''}`}>
      {work && (post.pinned || post.kind === 'announcement') && (
        <div className="work-tags">
          {!!post.pinned && <span className="wtag pin"><Icon name="pin" size={12} /> Pinned</span>}
          {post.kind === 'announcement' && <span className="wtag ann"><Icon name="megaphone" size={12} /> Announcement</span>}
        </div>
      )}
      {post.repost_of && (
        <div className="repost-tag"><Icon name="repost" size={14} /> {post.author.id === user.id ? 'You' : post.author.full_name} reposted · {timeAgo(post.created_at)}</div>
      )}
      {post.repost_of && (!post.original || post.original.unavailable) ? (
        <div className="quoted muted small">This post is unavailable.</div>
      ) : (
        <>
          <div className="post-head">
            <Avatar user={target.author} size={40} onClick={() => nav(`/u/${target.author.id}`)} />
            <div className="who">
              <div className="name">
                <Link to={`/u/${target.author.id}`} style={{ color: 'inherit' }}>{target.author.full_name}</Link>
                <span className="time">{timeAgo(target.created_at)}</span>
              </div>
              <PostInner post={target} onOpenImage={setImg} />
            </div>
            <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => setSheet('menu')} aria-label="More"><Icon name="more" size={18} /></button>
          </div>
          <div className="post-body">
            <div className="actions">
              <button className={target.liked ? 'liked' : ''} onClick={like} aria-label="Like">
                <Icon name="heart" size={20} fill={target.liked ? 'currentColor' : 'none'} /> {target.likes}
              </button>
              <button onClick={() => openThread()} aria-label="Comments"><Icon name="comment" size={19} /> {target.comments}</button>
              {!work && <button className={target.reposted ? 'reposted' : ''} onClick={repost} disabled={target.author.id === user.id} aria-label="Repost">
                <Icon name="repost" size={19} /> {target.reposts}
              </button>}
              <button className="push" onClick={() => setSheet('share')} aria-label="Share"><Icon name="share" size={22} fill="currentColor" stroke={0} /></button>
            </div>
            {/* Threads-style comment preview; tapping opens the post's thread page. */}
            {!detail && target.comment_preview && (
              <button className="comment-peek" onClick={() => openThread()}>
                <Avatar user={target.comment_preview.author} size={20} />
                <span><b>{target.comment_preview.author?.full_name}</b> {target.comment_preview.text || '📷 Image'}</span>
              </button>
            )}
            {!detail && <button className="comment-more" onClick={() => openThread()}>
              {target.comments ? `View ${target.comments === 1 ? '1 comment' : `all ${target.comments} comments`}` : 'Add a comment…'}
            </button>}
          </div>
        </>
      )}
      <Lightbox src={img} onClose={() => setImg(null)} />
      {sheet === 'share' && <ShareSheet post={target} onClose={() => setSheet(null)} onCopy={copyLink} />}
      {sheet === 'menu' && (
        <Sheet title="" onClose={() => setSheet(null)}>
          <div className="menu-list">
            <button onClick={() => { setSheet(null); nav(`/post/${target.id}`); }}><Icon name="eye" /> Open post</button>
            <button onClick={save}><Icon name="bookmark" fill={target.saved ? 'currentColor' : 'none'} /> {target.saved ? 'Remove from saved' : 'Save post'}</button>
            {work && canManage && <button onClick={pin}><Icon name="pin" /> {post.pinned ? 'Unpin' : 'Pin to top'}</button>}
            <button onClick={copyLink}><Icon name="link" /> Copy link</button>
            <button onClick={() => { setSheet(null); nav(`/u/${target.author.id}`); }}><Icon name="user" /> View {target.author.full_name.split(' ')[0]}'s profile</button>
            {(post.author.id === user.id || (work && canManage)) && (
              <button className="danger" onClick={() => setSheet('delete')}><Icon name="trash" /> {post.repost_of ? 'Remove repost' : 'Delete post'}</button>
            )}
          </div>
        </Sheet>
      )}
      {sheet === 'delete' && (
        <Confirm title={post.repost_of ? 'Remove repost?' : 'Delete post?'} message="This can't be undone." danger confirmLabel="Delete"
          onClose={() => setSheet(null)}
          onConfirm={async () => {
            await api(`/posts/${post.id}`, { method: 'DELETE' });
            toast('Deleted');
            onDeleted?.(post.id);
          }} />
      )}
    </article>
  );
}

export function Composer({ onClose, onPosted }) {
  const { user, toast } = useApp();
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const [editPhoto, photoEditor] = usePhotoEditing(files, setFiles);
  const submit = async () => {
    setBusy(true);
    try {
      const p = await api('/posts', { method: 'POST', form: toForm({ text, images: files }) });
      onPosted(p);
      toast('Posted', 'success');
      onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Create post" onClose={onClose}
      footer={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="icon-btn" onClick={() => fileRef.current.click()} aria-label="Add photos"><Icon name="image" /></button>
        <span className="muted small" style={{ flex: 1 }}>{files.length ? `${files.length}/10 photos` : 'Add photos'}</span>
        <button className="btn" disabled={busy || (!text.trim() && !files.length)} onClick={submit}>{busy ? 'Posting…' : 'Post'}</button>
      </div>}>
      <div style={{ display: 'flex', gap: 10 }}>
        <Avatar user={user} size={40} />
        <textarea className="input" autoFocus placeholder="What's on your mind? Add a caption…" value={text} onChange={(e) => setText(e.target.value)}
          style={{ border: 0, background: 'transparent', minHeight: 110, padding: '8px 0' }} maxLength={5000} />
      </div>
      <FilePreviews files={files} onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} onEdit={editPhoto} />
      {files.length > 0 && <p className="small muted" style={{ margin: '8px 0 0' }}>Tap a photo to crop, zoom or rotate it.</p>}
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { setFiles([...files, ...e.target.files].slice(0, 10)); e.target.value = ''; }} />
      {photoEditor}
    </Sheet>
  );
}

const REACTIONS = ['❤️', '👍', '😂', '😮'];

/** Renders @mentions (from the comment's mention list) as profile links. */
export function MentionText({ text, mentions = [] }) {
  if (!text) return null;
  if (!mentions.length) return text;
  const names = mentions.map((m) => `@${m.name}`).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return text.split(re).map((part, i) => {
    const m = mentions.find((x) => `@${x.name}` === part);
    return m ? <Link key={i} to={`/u/${m.id}`} className="mention">{part}</Link> : <Fragment key={i}>{part}</Fragment>;
  });
}

/** One comment in Threads layout: avatar column with a thread line, body on the right. */
function CommentItem({ c, postAuthorId, onReply, onDelete, canDelete, onReact, isReply, last }) {
  const nav = useNavigate();
  const [img, setImg] = useState(null);
  const [picking, setPicking] = useState(false);
  const counts = Object.entries(c.reactions || {});
  const total = counts.reduce((a, [, n]) => a + n, 0);
  const hasReplies = c.replies?.length > 0;
  return (
    <div className={`t-comment ${isReply ? 'reply' : ''}`}>
      <div className="t-rail">
        <Avatar user={c.author} size={isReply ? 30 : 38} onClick={() => nav(`/u/${c.author.id}`)} />
        {(hasReplies || (isReply && !last)) && <span className="t-line" />}
      </div>
      <div className="t-body">
        <div className="t-head">
          <b onClick={() => nav(`/u/${c.author.id}`)}>{c.author.full_name}</b>
          <span>{timeAgo(c.created_at)}</span>
          {c.author.id === postAuthorId && <span className="t-author">Author</span>}
          {canDelete(c) && <button className="t-more" onClick={() => onDelete(c)} aria-label="Delete comment"><Icon name="trash" size={15} /></button>}
        </div>
        {c.text && <div className="t-text"><MentionText text={c.text} mentions={c.mentions} /></div>}
        {c.image && <img className="t-img" src={c.image} alt="Comment attachment" onClick={() => setImg(c.image)} />}
        <div className="t-actions">
          <button className={c.my_reaction === '❤️' ? 'liked' : ''} onClick={() => onReact(c, '❤️')} aria-label="Like comment">
            <Icon name="heart" size={19} fill={c.my_reaction === '❤️' ? 'currentColor' : 'none'} />{total > 0 && <span>{total}</span>}
          </button>
          <button onClick={() => onReply(c)} aria-label="Reply"><Icon name="comment" size={19} />{c.replies?.length > 0 && <span>{c.replies.length}</span>}</button>
          <button onClick={() => setPicking(!picking)} aria-label="React with emoji" className={c.my_reaction && c.my_reaction !== '❤️' ? 'on' : ''}>
            {c.my_reaction && c.my_reaction !== '❤️' ? <span style={{ fontSize: 17 }}>{c.my_reaction}</span> : <Icon name="smile" size={19} />}
          </button>
          {counts.length > 0 && <span className="c-reacts">{counts.map(([e, n]) => <span key={e}>{e}{n > 1 ? n : ''}</span>)}</span>}
        </div>
        {picking && (
          <div className="react-pop" role="menu">
            {REACTIONS.map((e) => (
              <button key={e} className={c.my_reaction === e ? 'on' : ''} onClick={() => { setPicking(false); onReact(c, e); }} aria-label={`React ${e}`}>{e}</button>
            ))}
          </div>
        )}
        {hasReplies && c.replies.map((r, i) => (
          <CommentItem key={r.id} c={r} isReply last={i === c.replies.length - 1} postAuthorId={postAuthorId}
            onReply={() => onReply(c, r)} onDelete={onDelete} canDelete={canDelete} onReact={onReact} />
        ))}
      </div>
      <Lightbox src={img} onClose={() => setImg(null)} />
    </div>
  );
}

/**
 * Threads-style replies under a post: inline list (infinite scroll) and a reply bar fixed to
 * the bottom of the screen. Supports replies, ❤️/👍/😂/😮 reactions, @mentions and image comments.
 */
export function CommentThread({ post, onCount, focusRef }) {
  const { user, toast } = useApp();
  const [list, setList] = useState([]);
  const [next, setNext] = useState(0);
  const [total, setTotal] = useState(post.comments);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [mentions, setMentions] = useState([]);
  const [suggest, setSuggest] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const inputRef = useRef();
  const sentinel = useRef();
  if (focusRef) focusRef.current = () => inputRef.current?.focus();

  const loadMore = useCallback(async () => {
    if (next === null || loading) return;
    setLoading(true);
    try {
      const r = await api(`/posts/${post.id}/comments?after=${next}&limit=15`);
      setList((l) => [...l, ...r.comments]);
      setNext(r.nextAfter);
      setTotal(r.total);
    } finally { setLoading(false); }
  }, [next, loading, post.id]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && loadMore(), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const token = /(?:^|\s)@([^@\n]{0,30})$/.exec(text)?.[1];
  useEffect(() => {
    if (token === undefined) { setSuggest([]); return undefined; }
    const t = setTimeout(() => api(`/mention-suggestions?q=${encodeURIComponent(token)}`).then(setSuggest).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [token]);
  const addMention = (u) => setMentions((m) => (m.some((x) => x.id === u.id) ? m : [...m, u]));
  const pickMention = (u) => {
    setText(text.replace(/@([^@\n]{0,30})$/, `@${u.full_name} `));
    addMention(u);
    setSuggest([]);
    inputRef.current?.focus();
  };
  // Replying to a reply keeps the thread one level deep and tags that person.
  const startReply = (parent, target = parent) => {
    setReplyTo({ ...parent, target });
    if (target.author.id !== user.id) { setText(`@${target.author.full_name} `); addMention(target.author); } else setText('');
    inputRef.current?.focus();
  };

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() && !file) return;
    setBusy(true);
    try {
      const c = await api(`/posts/${post.id}/comments`, {
        method: 'POST',
        form: toForm({ text, image: file, parent_id: replyTo?.id, mentions: JSON.stringify(mentions.filter((m) => text.includes(`@${m.full_name}`)).map((m) => m.id)) }),
      });
      setList((l) => (c.parent_id ? l.map((x) => (x.id === c.parent_id ? { ...x, replies: [...x.replies, c] } : x)) : next === null ? [...l, c] : l));
      setTotal((t) => t + 1);
      onCount?.(total + 1);
      setText(''); setFile(null); setReplyTo(null); setMentions([]);
      if (!c.parent_id && next !== null) toast('Reply posted');
    } catch (ex) { toast(ex.message, 'error'); } finally { setBusy(false); }
  };
  const patch = (id, fn) => setList((l) => l.map((x) => (x.id === id ? fn(x) : { ...x, replies: x.replies.map((r) => (r.id === id ? fn(r) : r)) })));
  const react = async (c, emoji) => {
    try { const r = await api(`/comments/${c.id}/react`, { method: 'POST', body: { emoji } }); patch(c.id, (x) => ({ ...x, ...r })); } catch (ex) { toast(ex.message, 'error'); }
  };
  const del = async (c) => {
    await api(`/comments/${c.id}`, { method: 'DELETE' });
    const removed = 1 + (c.replies?.length || 0);
    setList((l) => l.filter((x) => x.id !== c.id).map((x) => ({ ...x, replies: x.replies.filter((r) => r.id !== c.id) })));
    setTotal((t) => t - removed);
    onCount?.(total - removed);
  };
  const canDelete = (x) => x.author.id === user.id || post.author.id === user.id;

  return (
    <>
      <div className="t-section"><b>Replies</b><span>{total} {total === 1 ? 'reply' : 'replies'}</span></div>
      {!list.length && next === null && <div className="t-empty">No replies yet. Start the conversation.</div>}
      {list.map((c) => (
        <CommentItem key={c.id} c={c} postAuthorId={post.author.id} onReply={startReply} onDelete={del} onReact={react} canDelete={canDelete} />
      ))}
      {next !== null && <div ref={sentinel}>{loading ? <Spinner /> : <div style={{ height: 24 }} />}</div>}

      <form className="t-composer" onSubmit={send}>
        {suggest.length > 0 && (
          <div className="mention-suggest">
            {suggest.map((u) => <button type="button" key={u.id} onClick={() => pickMention(u)}><Avatar user={u} size={26} /> {u.full_name}</button>)}
          </div>
        )}
        {(replyTo || file) && (
          <div className="t-context">
            {replyTo && <span>Replying to <b>{replyTo.target.author.full_name}</b>…</span>}
            {file && <span>📷 Image attached</span>}
            <button type="button" onClick={() => { setReplyTo(null); setFile(null); setText(''); setMentions([]); }} aria-label="Cancel"><Icon name="close" size={14} /></button>
          </div>
        )}
        <div className="t-bar">
          <Avatar user={user} size={34} />
          <input ref={inputRef} placeholder={replyTo ? `Reply to ${replyTo.target.author.full_name.split(' ')[0]}…` : 'Add your reply…'} value={text}
            onChange={(e) => setText(e.target.value)} maxLength={2000} aria-label="Add your reply" />
          {text.trim() || file ? (
            <button className="t-send" disabled={busy} aria-label="Post reply"><Icon name="send" size={20} /></button>
          ) : (
            <>
              <button type="button" className="t-icon" onClick={() => fileRef.current.click()} aria-label="Attach image"><Icon name="image" size={22} /></button>
              <button type="button" className="t-icon" onClick={() => { setText((t) => `${t}@`); inputRef.current?.focus(); }} aria-label="Tag someone"><span style={{ fontWeight: 800, fontSize: 18 }}>@</span></button>
            </>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { setFile(e.target.files[0] || null); e.target.value = ''; }} />
      </form>
    </>
  );
}

export function ShareSheet({ post, onClose, onCopy, endpoint }) {
  const { toast } = useApp();
  const { data, loading } = useLoad(() => api('/conversations'), []);
  const friends = useLoad(() => api('/friends'), []);
  const [picked, setPicked] = useState([]);
  const [pickedFriends, setPickedFriends] = useState([]);
  const [text, setText] = useState('');
  const [tab, setTab] = useState('chats');
  const [busy, setBusy] = useState(false);
  const toggle = (arr, set, id) => set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  const send = async () => {
    setBusy(true);
    try {
      const ids = [...picked];
      // Friends without an existing chat get a direct conversation first.
      for (const fid of pickedFriends) {
        const c = await api('/conversations/direct', { method: 'POST', body: { userId: fid } });
        if (!ids.includes(c.id)) ids.push(c.id);
      }
      await api(endpoint || `/posts/${post.id}/share`, { method: 'POST', body: { conversationIds: ids, text } });
      toast(`Sent to ${ids.length} chat${ids.length > 1 ? 's' : ''}`, 'success');
      onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const groups = (data || []).filter((c) => c.type === 'group');
  const directs = (data || []).filter((c) => c.type === 'direct');
  const total = picked.length + pickedFriends.length;
  return (
    <Sheet title="Share" onClose={onClose}
      footer={<div style={{ display: 'flex', gap: 8 }}>
        <input className="input" placeholder="Add a message…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" disabled={!total || busy} onClick={send}>Send{total ? ` (${total})` : ''}</button>
      </div>}>
      <div className="menu-list" style={{ marginTop: -6 }}>
        <button onClick={onCopy}><Icon name="link" /> Copy link</button>
      </div>
      <div className="seg" style={{ margin: '12px 0 8px' }}>
        <button className={tab === 'chats' ? 'active' : ''} onClick={() => setTab('chats')}><Icon name="user" size={16} /> Private</button>
        <button className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}><Icon name="users" size={16} /> Groups</button>
      </div>
      {loading ? <Spinner /> : tab === 'groups' ? (
        groups.length ? groups.map((c) => (
          <div key={c.id} className={`check-row ${picked.includes(c.id) ? 'on' : ''}`} onClick={() => toggle(picked, setPicked, c.id)}>
            <Avatar src={c.avatar} size={38} /><div style={{ flex: 1, fontWeight: 600 }}>{c.title}</div><span className="box"><Icon name="check" size={14} /></span>
          </div>
        )) : <Empty icon="users" title="No group chats">Create one from the Chats tab.</Empty>
      ) : (
        <>
          {directs.map((c) => (
            <div key={c.id} className={`check-row ${picked.includes(c.id) ? 'on' : ''}`} onClick={() => toggle(picked, setPicked, c.id)}>
              <Avatar src={c.avatar} size={38} /><div style={{ flex: 1, fontWeight: 600 }}>{c.title}</div><span className="box"><Icon name="check" size={14} /></span>
            </div>
          ))}
          {(friends.data || []).filter((f) => !directs.some((c) => c.other?.id === f.id)).map((f) => (
            <div key={`f${f.id}`} className={`check-row ${pickedFriends.includes(f.id) ? 'on' : ''}`} onClick={() => toggle(pickedFriends, setPickedFriends, f.id)}>
              <Avatar user={f} size={38} /><div style={{ flex: 1, fontWeight: 600 }}>{f.full_name}</div><span className="box"><Icon name="check" size={14} /></span>
            </div>
          ))}
          {!directs.length && !friends.data?.length && <Empty icon="userPlus" title="No friends yet">Add friends to share posts privately.</Empty>}
        </>
      )}
    </Sheet>
  );
}
