import { Router } from 'express';
import { all, get, run } from '../db.js';
import { auth } from '../auth.js';
import { h } from '../util.js';

const r = Router();
r.use(auth());

// Audience follows the app the token was issued for: client app vs admin dashboard.
r.get('/notifications', h((req, res) => {
  const audience = req.app_kind === 'admin' ? 'admin' : 'client';
  const before = Number(req.query.before) || 1e15;
  const type = req.query.type ? String(req.query.type) : null;
  const rows = all(
    `SELECT n.*, u.full_name AS actor_name, u.avatar AS actor_avatar FROM notifications n
     LEFT JOIN users u ON u.id = n.actor_id
     WHERE n.user_id = ? AND n.audience = ? AND n.id < ? AND (? IS NULL OR n.type = ?)
     ORDER BY n.id DESC LIMIT 50`,
    req.user.id, audience, before, type, type
  ).map((n) => ({ ...n, data: n.data ? JSON.parse(n.data) : null }));
  res.json(rows);
}));

r.get('/notifications/unread-count', h((req, res) => {
  const audience = req.app_kind === 'admin' ? 'admin' : 'client';
  const c = get(`SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND audience = ? AND is_read = 0 AND type != 'message'`, req.user.id, audience).c;
  const m = get(`SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND audience = ? AND is_read = 0 AND type = 'message'`, req.user.id, audience).c;
  res.json({ count: c, messages: m });
}));

r.post('/notifications/read-all', h((req, res) => {
  const audience = req.app_kind === 'admin' ? 'admin' : 'client';
  run("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND audience = ? AND type != 'message'", req.user.id, audience);
  res.json({ ok: true });
}));

r.post('/notifications/:id/read', h((req, res) => {
  run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  res.json({ ok: true });
}));

r.delete('/notifications/:id', h((req, res) => {
  run('DELETE FROM notifications WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  res.json({ ok: true });
}));

export default r;
