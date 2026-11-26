import { Router } from 'express';
import { get, all, run, tx } from '../db.js';
import { auth } from '../auth.js';
import { h, fail, imageUpload, fileUrl, deleteStoredFiles, publicUser, friendIds, canViewProfile, areFriends, blockedIds } from '../util.js';
import { notify } from '../notify.js';
import { postMessage } from './chats.js';
import { canAccessTeam, canManageTeam } from '../teams.js';
import { forYou } from '../feed.js';

// Work posts are visible to their team's members only; social posts follow profile privacy.
const canSeePost = (p, viewerId, author) => (p.team_id ? canAccessTeam(viewerId, p.team_id) : canViewProfile(viewerId, author));

const r = Router();
r.use(auth());

export function hydratePost(p, viewerId, depth = 0) {
  if (!p) return null;
  const author = publicUser(p.user_id);
  if (!author || !canSeePost(p, viewerId, author)) return depth ? { id: p.id, unavailable: true } : null;
  const out = {
    ...p,
    author,
    images: all('SELECT url FROM post_images WHERE post_id = ? ORDER BY position', p.id).map((x) => x.url),
    likes: get('SELECT COUNT(*) c FROM likes WHERE post_id = ?', p.id).c,
    liked: !!get('SELECT 1 x FROM likes WHERE post_id = ? AND user_id = ?', p.id, viewerId),
    comments: get('SELECT COUNT(*) c FROM comments WHERE post_id = ?', p.id).c,
    reposts: get('SELECT COUNT(*) c FROM posts WHERE repost_of = ?', p.id).c,
    reposted: !!get('SELECT 1 x FROM posts WHERE repost_of = ? AND user_id = ?', p.id, viewerId),
    saved: !!get('SELECT 1 x FROM saved_posts WHERE post_id = ? AND user_id = ?', p.id, viewerId),
  };
  // Threads-style preview: the latest top-level comment under the post.
  if (!p.repost_of && depth === 0) {
    const last = get('SELECT id, user_id, text, image FROM comments WHERE post_id = ? AND parent_id IS NULL ORDER BY id DESC LIMIT 1', p.id);
    out.comment_preview = last ? { ...last, author: publicUser(last.user_id) } : null;
  }
  if (p.repost_of && depth === 0) {
    out.original = hydratePost(get('SELECT * FROM posts WHERE id = ?', p.repost_of), viewerId, 1) || { id: p.repost_of, unavailable: true };
  }
  return out;
}
export const hydratePosts = (rows, viewerId) => rows.map((p) => hydratePost(p, viewerId)).filter(Boolean);

r.get('/posts/feed', h((req, res) => {
  const me = req.user.id;
  const tab = req.query.tab === 'friends' ? 'friends' : 'foryou';
  // For You is ranked and shuffled per refresh: the app sends a new `seed` on each refresh and pages with `page`.
  if (tab === 'foryou' && req.query.seed !== undefined) {
    const { rows, next } = forYou(me, { seed: Number(req.query.seed) || 1, page: Math.max(0, Number(req.query.page) || 0) });
    const reasons = new Map(rows.map((x) => [x.p.id, x.reason]));
    return res.json({ posts: hydratePosts(rows.map((x) => x.p), me).map((p) => ({ ...p, reason: reasons.get(p.id) || null })), nextPage: next });
  }
  const before = Number(req.query.before) || 1e15;
  const ids = [me, ...friendIds(me)];
  const ph = ids.map(() => '?').join(',');
  const hidden = new Set(blockedIds(me));
  const rows0 = tab === 'friends'
    ? all(`SELECT * FROM posts WHERE user_id IN (${ph}) AND team_id IS NULL AND id < ? ORDER BY id DESC LIMIT 15`, ...ids, before)
    : all(
      `SELECT p.* FROM posts p JOIN users u ON u.id = p.user_id
       WHERE u.status = 'active' AND p.team_id IS NULL AND (p.user_id IN (${ph}) OR u.privacy = 'public') AND p.id < ?
       ORDER BY p.id DESC LIMIT 15`, ...ids, before);
  const rows = rows0.filter((p) => !hidden.has(p.user_id));
  res.json({ posts: hydratePosts(rows, me), nextBefore: rows0.length === 15 ? rows0[rows0.length - 1].id : null });
}));

r.get('/posts/:id', h((req, res) => {
  const p = hydratePost(get('SELECT * FROM posts WHERE id = ?', Number(req.params.id)), req.user.id);
  if (!p) fail(404, 'Post not found or not visible to you.');
  res.json(p);
}));

r.post('/posts', imageUpload.array('images', 10), h((req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 5000);
  const files = req.files || [];
  if (!text && !files.length) fail(400, 'Write something or add a photo.');
  const id = tx(() => {
    const id = Number(run('INSERT INTO posts (user_id, text) VALUES (?, ?)', req.user.id, text).lastInsertRowid);
    files.forEach((f, i) => run('INSERT INTO post_images (post_id, url, position) VALUES (?, ?, ?)', id, fileUrl(f), i));
    return id;
  });
  res.status(201).json(hydratePost(get('SELECT * FROM posts WHERE id = ?', id), req.user.id));
}));

r.delete('/posts/:id', h((req, res) => {
  const p = get('SELECT * FROM posts WHERE id = ?', Number(req.params.id));
  if (!p) fail(404, 'Post not found.');
  if (p.user_id !== req.user.id && !(p.team_id && canManageTeam(req.user, p.team_id))) fail(403, 'You can only delete your own posts.');
  const files = [
    ...all('SELECT url FROM post_images WHERE post_id = ?', p.id).map((x) => x.url),
    ...all('SELECT image FROM comments WHERE post_id = ? AND image IS NOT NULL', p.id).map((x) => x.image),
  ];
  run('DELETE FROM posts WHERE id = ?', p.id);
  deleteStoredFiles(files); // photos are removed from storage permanently
  res.json({ ok: true });
}));

const visiblePost = (id, viewerId) => {
  const p = get('SELECT * FROM posts WHERE id = ?', Number(id));
  if (!p) fail(404, 'Post not found.');
  const author = get('SELECT id, privacy FROM users WHERE id = ?', p.user_id);
  if (!canSeePost(p, viewerId, author)) fail(403, 'This post is not visible to you.');
  return p;
};

r.post('/posts/:id/like', h((req, res) => {
  const p = visiblePost(req.params.id, req.user.id);
  const existing = get('SELECT 1 x FROM likes WHERE post_id = ? AND user_id = ?', p.id, req.user.id);
  if (existing) run('DELETE FROM likes WHERE post_id = ? AND user_id = ?', p.id, req.user.id);
  else {
    run('INSERT INTO likes (post_id, user_id) VALUES (?, ?)', p.id, req.user.id);
    notify({ userId: p.user_id, type: 'like', actorId: req.user.id, entityType: 'post', entityId: p.id, title: 'New like', body: `${req.user.full_name} liked your post.` });
  }
  res.json({ liked: !existing, likes: get('SELECT COUNT(*) c FROM likes WHERE post_id = ?', p.id).c });
}));

r.post('/posts/:id/repost', h((req, res) => {
  let p = visiblePost(req.params.id, req.user.id);
  if (p.repost_of) p = visiblePost(p.repost_of, req.user.id); // repost the original
  if (p.team_id) fail(400, 'Work posts stay inside your team and can’t be reposted.');
  if (p.user_id === req.user.id) fail(400, "You can't repost your own post.");
  const mine = get('SELECT id FROM posts WHERE repost_of = ? AND user_id = ?', p.id, req.user.id);
  if (mine) run('DELETE FROM posts WHERE id = ?', mine.id);
  else {
    run('INSERT INTO posts (user_id, text, repost_of) VALUES (?, ?, ?)', req.user.id, String(req.body?.text || '').slice(0, 1000), p.id);
    notify({ userId: p.user_id, type: 'repost', actorId: req.user.id, entityType: 'post', entityId: p.id, title: 'New repost', body: `${req.user.full_name} reposted your post.` });
  }
  res.json({ reposted: !mine, reposts: get('SELECT COUNT(*) c FROM posts WHERE repost_of = ?', p.id).c });
}));

// Save / unsave a post (shown in Profile → Saved, visible only to you).
r.post('/posts/:id/save', h((req, res) => {
  const p = visiblePost(req.params.id, req.user.id);
  const had = get('SELECT 1 x FROM saved_posts WHERE post_id = ? AND user_id = ?', p.id, req.user.id);
  if (had) run('DELETE FROM saved_posts WHERE post_id = ? AND user_id = ?', p.id, req.user.id);
  else run('INSERT INTO saved_posts (user_id, post_id) VALUES (?, ?)', req.user.id, p.id);
  res.json({ saved: !had });
}));
r.get('/users/me/saved', h((req, res) => {
  const rows = all('SELECT p.* FROM saved_posts s JOIN posts p ON p.id = s.post_id WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 200', req.user.id);
  res.json(hydratePosts(rows, req.user.id));
}));

// Share a post into one or more chats (private or group).
r.post('/posts/:id/share', h((req, res) => {
  const p = visiblePost(req.params.id, req.user.id);
  const ids = (req.body?.conversationIds || []).map(Number).filter(Boolean);
  if (!ids.length) fail(400, 'Choose at least one chat.');
  ids.forEach((cid) => postMessage({ conversationId: cid, sender: req.user, text: String(req.body?.text || '').slice(0, 1000), sharedPostId: p.id }));
  res.json({ ok: true, sent: ids.length });
}));

// ---------- comments ----------
export const COMMENT_REACTIONS = ['❤️', '👍', '😂', '😮'];
function hydrateComment(c, viewerId) {
  const reacts = all('SELECT emoji, COUNT(*) n FROM comment_reactions WHERE comment_id = ? GROUP BY emoji', c.id);
  return {
    ...c,
    mentions: JSON.parse(c.mentions || '[]'),
    author: publicUser(c.user_id),
    reactions: Object.fromEntries(reacts.map((r) => [r.emoji, r.n])),
    my_reaction: get('SELECT emoji FROM comment_reactions WHERE comment_id = ? AND user_id = ?', c.id, viewerId)?.emoji || null,
  };
}

// Paged, oldest first (infinite scroll loads the next page with ?after=<last id>).
r.get('/posts/:id/comments', h((req, res) => {
  const p = visiblePost(req.params.id, req.user.id);
  const after = Number(req.query.after) || 0;
  const limit = Math.min(Number(req.query.limit) || 15, 50);
  const hidden = new Set(blockedIds(req.user.id));
  const top = all('SELECT * FROM comments WHERE post_id = ? AND parent_id IS NULL AND id > ? ORDER BY id LIMIT ?', p.id, after, limit);
  const comments = top.filter((c) => !hidden.has(c.user_id)).map((c) => ({
    ...hydrateComment(c, req.user.id),
    replies: all('SELECT * FROM comments WHERE parent_id = ? ORDER BY id', c.id).filter((x) => !hidden.has(x.user_id)).map((x) => hydrateComment(x, req.user.id)),
  }));
  res.json({
    comments,
    nextAfter: top.length === limit ? top[top.length - 1].id : null,
    total: get('SELECT COUNT(*) c FROM comments WHERE post_id = ?', p.id).c,
  });
}));

r.post('/posts/:id/comments', imageUpload.single('image'), h((req, res) => {
  const p = visiblePost(req.params.id, req.user.id);
  const text = String(req.body?.text || '').trim().slice(0, 2000);
  if (!text && !req.file) fail(400, 'Write a comment or attach an image.');
  let parentId = Number(req.body?.parent_id) || null;
  let parent = null;
  if (parentId) {
    parent = get('SELECT * FROM comments WHERE id = ? AND post_id = ?', parentId, p.id);
    if (!parent) fail(404, 'Comment not found.');
    if (parent.parent_id) parentId = parent.parent_id; // keep threads one level deep
  }
  // @mentions: the client sends the tagged user ids; keep only ones whose "@Name" is still in the text.
  let ids = [];
  try { ids = JSON.parse(req.body?.mentions || '[]').map(Number); } catch { /* none */ }
  const mentions = [...new Set(ids)].map(publicUser).filter((u) => u && text.includes(`@${u.full_name}`)).map((u) => ({ id: u.id, name: u.full_name }));
  const id = Number(run('INSERT INTO comments (post_id, user_id, parent_id, text, image, mentions) VALUES (?, ?, ?, ?, ?, ?)',
    p.id, req.user.id, parentId, text, fileUrl(req.file), JSON.stringify(mentions)).lastInsertRowid);
  const preview = text.slice(0, 80) || '📷 Photo';
  const told = new Set([req.user.id]);
  if (parent && parent.user_id !== req.user.id) {
    notify({ userId: parent.user_id, type: 'reply', actorId: req.user.id, entityType: 'post', entityId: p.id, title: 'New reply', body: `${req.user.full_name} replied: ${preview}` });
    told.add(parent.user_id);
  }
  if (!told.has(p.user_id)) {
    notify({ userId: p.user_id, type: 'comment', actorId: req.user.id, entityType: 'post', entityId: p.id, title: 'New comment', body: `${req.user.full_name} commented: ${preview}` });
    told.add(p.user_id);
  }
  mentions.filter((m) => !told.has(m.id)).forEach((m) =>
    notify({ userId: m.id, type: 'mention', actorId: req.user.id, entityType: 'post', entityId: p.id, title: 'You were mentioned', body: `${req.user.full_name} mentioned you: ${preview}` }));
  res.status(201).json({ ...hydrateComment(get('SELECT * FROM comments WHERE id = ?', id), req.user.id), replies: [] });
}));

r.post('/comments/:id/react', h((req, res) => {
  const c = get('SELECT * FROM comments WHERE id = ?', Number(req.params.id));
  if (!c) fail(404, 'Comment not found.');
  visiblePost(c.post_id, req.user.id);
  const emoji = String(req.body?.emoji || '');
  if (emoji && !COMMENT_REACTIONS.includes(emoji)) fail(400, 'Unsupported reaction.');
  const cur = get('SELECT emoji FROM comment_reactions WHERE comment_id = ? AND user_id = ?', c.id, req.user.id);
  if (!emoji || cur?.emoji === emoji) run('DELETE FROM comment_reactions WHERE comment_id = ? AND user_id = ?', c.id, req.user.id);
  else {
    run('INSERT INTO comment_reactions (comment_id, user_id, emoji) VALUES (?, ?, ?) ON CONFLICT(comment_id, user_id) DO UPDATE SET emoji = excluded.emoji', c.id, req.user.id, emoji);
    if (!cur) notify({ userId: c.user_id, type: 'comment_reaction', actorId: req.user.id, entityType: 'post', entityId: c.post_id, title: 'Comment reaction', body: `${req.user.full_name} reacted ${emoji} to your comment.` });
  }
  const h2 = hydrateComment(c, req.user.id);
  res.json({ reactions: h2.reactions, my_reaction: h2.my_reaction });
}));

// People you can @mention: your friends, plus the post author.
r.get('/mention-suggestions', h((req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  res.json(friendIds(req.user.id).map(publicUser).filter((u) => u && u.full_name.toLowerCase().includes(q)).slice(0, 6));
}));

r.delete('/comments/:id', h((req, res) => {
  const c = get('SELECT c.*, p.user_id AS post_owner FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?', Number(req.params.id));
  if (!c) fail(404, 'Comment not found.');
  if (c.user_id !== req.user.id && c.post_owner !== req.user.id) fail(403, 'Not allowed.');
  const files = all(`WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT c.id FROM comments c JOIN t ON c.parent_id = t.id)
    SELECT image FROM comments WHERE id IN (SELECT id FROM t) AND image IS NOT NULL`, c.id).map((x) => x.image);
  run('DELETE FROM comments WHERE id = ?', c.id);
  deleteStoredFiles(files);
  res.json({ ok: true });
}));

export { areFriends };
export default r;
