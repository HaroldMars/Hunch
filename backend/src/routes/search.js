import { Router } from 'express';
import { get, all, run } from '../db.js';
import { auth } from '../auth.js';
import { h, friendIds, blockedIds } from '../util.js';
import { hydratePosts } from './posts.js';
import { tokens } from '../feed.js';

// Search posts (people search lives at /users/search), plus each person's recent searches.
// Recent searches also tune the For You feed; anyone can clear theirs.
const r = Router();
r.use(auth());

r.get('/search/posts', h((req, res) => {
  const me = req.user.id;
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q.length < 2) return res.json([]);
  const words = [...new Set(tokens(q))].slice(0, 6);
  const ids = [me, ...friendIds(me)];
  const ph = ids.map(() => '?').join(',');
  const likeAny = [`%${q}%`, ...words.map((w) => `%${w}%`)];
  const rows = all(
    `SELECT p.* FROM posts p JOIN users u ON u.id = p.user_id
     WHERE u.status = 'active' AND p.team_id IS NULL AND p.repost_of IS NULL AND (p.user_id IN (${ph}) OR u.privacy = 'public')
       AND (${likeAny.map(() => 'p.text LIKE ?').join(' OR ')})
     ORDER BY p.id DESC LIMIT 200`, ...ids, ...likeAny);
  const hidden = new Set(blockedIds(me));
  const lower = q.toLowerCase();
  const scored = rows.filter((p) => !hidden.has(p.user_id)).map((p) => {
    const text = p.text.toLowerCase();
    const likes = get('SELECT COUNT(*) c FROM likes WHERE post_id = ?', p.id).c;
    const ageD = (Date.now() - Date.parse(p.created_at)) / 864e5;
    const score = (text.includes(lower) ? 3 : 0) + words.filter((w) => text.includes(w)).length + Math.log1p(likes) * 0.6 + Math.exp(-ageD / 14);
    return { p, score };
  }).sort((a, b) => b.score - a.score).slice(0, 40);
  res.json(hydratePosts(scored.map((x) => x.p), me));
}));

r.get('/search/recent', h((req, res) => {
  res.json(all('SELECT id, query, created_at FROM search_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 12', req.user.id));
}));
// Saved when someone settles on a search (opens a result or presses Enter); the same search moves to the top.
r.post('/search/recent', h((req, res) => {
  const q = String(req.body?.q || '').trim().slice(0, 100);
  if (q.length < 2) return res.json({ ok: false });
  run('DELETE FROM search_history WHERE user_id = ? AND lower(query) = lower(?)', req.user.id, q);
  run('INSERT INTO search_history (user_id, query) VALUES (?, ?)', req.user.id, q);
  run('DELETE FROM search_history WHERE user_id = ? AND id NOT IN (SELECT id FROM search_history WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50)', req.user.id, req.user.id);
  res.json({ ok: true });
}));
r.delete('/search/recent/:id', h((req, res) => {
  run('DELETE FROM search_history WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  res.json({ ok: true });
}));
r.delete('/search/recent', h((req, res) => {
  run('DELETE FROM search_history WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
}));

// Trending words from public posts in the last week, for the empty search screen.
r.get('/search/trending', h((req, res) => {
  const rows = all("SELECT p.text FROM posts p JOIN users u ON u.id = p.user_id WHERE u.privacy = 'public' AND u.status = 'active' AND p.team_id IS NULL AND p.created_at >= ? ORDER BY p.id DESC LIMIT 400",
    new Date(Date.now() - 7 * 864e5).toISOString());
  const counts = new Map();
  rows.forEach((x) => new Set(tokens(x.text)).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  res.json([...counts.entries()].filter(([t, n]) => n >= 2 && !/^\d+$/.test(t)).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([term, posts]) => ({ term, posts })));
}));

export default r;
