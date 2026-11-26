import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { get, all, run, userSettings, DEFAULT_USER_SETTINGS, UPLOAD_DIR } from '../db.js';
import { auth } from '../auth.js';
import {
  h, fail, imageUpload, fileUrl, deleteStoredFiles, PUBLIC_COLS, publicUser, selfUser, friendshipBetween, friendIds, canViewProfile, areFriends, isBlocked, blockedIds,
} from '../util.js';
import { notify, notifyStaff } from '../notify.js';
import { sessionPayload } from './auth.js';
import { workTeams, teammateIds } from '../teams.js';
import { readInterests } from './auth.js';
import { parseList } from '../util.js';
import { profileMood } from '../moods.js';

/** Work data on a profile. Teams are private: only the account owner ever sees their own. */
const ownWork = (u) => ({
  teams: workTeams(u.id).map((t) => ({ id: t.id, name: t.name, logo: t.logo, my_role: t.my_role })),
});
const USERNAME = /^[a-z0-9._]{3,30}$/i;
import { hydratePosts } from './posts.js';

const r = Router();
r.use(auth());

const relation = (me, other) => {
  if (me === other) return 'self';
  if (get('SELECT 1 x FROM blocks WHERE blocker_id = ? AND blocked_id = ?', me, other)) return 'blocked';
  const f = friendshipBetween(me, other);
  if (!f) return 'none';
  if (f.status === 'accepted') return 'friends';
  return f.requester_id === me ? 'outgoing' : 'incoming';
};

// Search by full name or user ID. Exact matches first, then prefix, then contains.
r.get('/users/search', h((req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const rows = all(
    `SELECT ${PUBLIC_COLS},
       CASE
         WHEN lower(full_name) = lower(?) OR upper(user_code) = upper(?) OR lower(username) = lower(?) THEN 0
         WHEN lower(full_name) LIKE lower(?) OR upper(user_code) LIKE upper(?) THEN 1
         ELSE 2 END AS rank
     FROM users
     WHERE status = 'active' AND (full_name LIKE ? OR user_code LIKE ? OR username LIKE ?)
     ORDER BY rank, full_name LIMIT 30`,
    q, q, q, `${q}%`, `${q}%`, like, like, like
  );
  const hidden = new Set(blockedIds(req.user.id));
  res.json(rows.filter((u) => !hidden.has(u.id)).map((u) => ({ ...u, exact: u.rank === 0, relation: relation(req.user.id, u.id) })));
}));

r.get('/users/:id', h((req, res) => {
  const u = get(`SELECT ${PUBLIC_COLS}, status FROM users WHERE id = ?`, Number(req.params.id));
  if (!u || u.status !== 'active') fail(404, 'User not found.');
  const me = req.user.id;
  if (get('SELECT 1 x FROM blocks WHERE blocker_id = ? AND blocked_id = ?', u.id, me)) fail(404, 'User not found.');
  const canView = canViewProfile(me, u);
  const counts = {
    posts: get('SELECT COUNT(*) c FROM posts WHERE user_id = ? AND repost_of IS NULL AND team_id IS NULL', u.id).c,
    reposts: get('SELECT COUNT(*) c FROM posts WHERE user_id = ? AND repost_of IS NOT NULL', u.id).c,
    friends: friendIds(u.id).length,
  };
  const mutuals = me === u.id ? 0 : friendIds(u.id).filter((id) => friendIds(me).includes(id)).length;
  const self = me === u.id;
  const interests = parseList(get('SELECT interests FROM users WHERE id = ?', u.id)?.interests);
  res.json({
    ...u,
    // Department and teams are work data: hidden from everyone but the owner.
    department: self ? req.user.department : '',
    ...(self ? ownWork(u) : {}),
    interests: canView || self ? interests : [],
    // Current mood: for you, your friends and Work Mode teammates. It never reveals the team itself.
    current_mood: profileMood(me, u.id),
    relation: relation(me, u.id),
    canView,
    counts,
    mutuals,
    friendRequestId: friendshipBetween(me, u.id)?.id || null,
  });
}));

r.patch('/users/me', h((req, res) => {
  const allowed = ['full_name', 'bio', 'job_title', 'department', 'location', 'privacy'];
  const b = req.body || {};
  if (b.interests !== undefined) run('UPDATE users SET interests = ? WHERE id = ?', JSON.stringify(readInterests(b.interests)), req.user.id);
  if (b.username !== undefined) {
    const name = String(b.username || '').trim().replace(/^@/, '');
    if (!name) run('UPDATE users SET username = NULL WHERE id = ?', req.user.id);
    else {
      if (!USERNAME.test(name)) fail(400, 'Usernames are 3–30 letters, numbers, dots or underscores.');
      if (get('SELECT id FROM users WHERE username = ? AND id != ?', name, req.user.id)) fail(409, 'That username is taken.');
      run('UPDATE users SET username = ? WHERE id = ?', name, req.user.id);
    }
  }
  for (const k of allowed) {
    if (b[k] === undefined) continue;
    let v = String(b[k]).trim();
    if (k === 'full_name' && !v) fail(400, 'Name cannot be empty.');
    if (k === 'privacy' && !['public', 'friends'].includes(v)) fail(400, 'Invalid privacy option.');
    v = v.slice(0, k === 'bio' ? 300 : 80);
    run(`UPDATE users SET ${k} = ? WHERE id = ?`, v, req.user.id);
  }
  res.json(selfUser(get('SELECT * FROM users WHERE id = ?', req.user.id)));
}));

r.post('/users/me/avatar', imageUpload.single('avatar'), h((req, res) => {
  if (!req.file) fail(400, 'Choose an image.');
  run('UPDATE users SET avatar = ? WHERE id = ?', fileUrl(req.file), req.user.id);
  deleteStoredFiles(req.user.avatar); // the previous photo is deleted permanently
  res.json(selfUser(get('SELECT * FROM users WHERE id = ?', req.user.id)));
}));

r.post('/users/me/cover', imageUpload.single('cover'), h((req, res) => {
  if (!req.file) fail(400, 'Choose an image.');
  run('UPDATE users SET cover = ? WHERE id = ?', fileUrl(req.file), req.user.id);
  deleteStoredFiles(req.user.cover);
  res.json(selfUser(get('SELECT * FROM users WHERE id = ?', req.user.id)));
}));

r.delete('/users/me/cover', h((req, res) => {
  run('UPDATE users SET cover = NULL WHERE id = ?', req.user.id);
  deleteStoredFiles(req.user.cover);
  res.json(selfUser(get('SELECT * FROM users WHERE id = ?', req.user.id)));
}));

r.delete('/users/me/avatar', h((req, res) => {
  run('UPDATE users SET avatar = NULL WHERE id = ?', req.user.id);
  deleteStoredFiles(req.user.avatar);
  res.json(selfUser(get('SELECT * FROM users WHERE id = ?', req.user.id)));
}));

r.get('/users/:id/posts', h((req, res) => {
  const u = get('SELECT id, privacy FROM users WHERE id = ?', Number(req.params.id));
  if (!u) fail(404, 'User not found.');
  if (!canViewProfile(req.user.id, u)) return res.json([]);
  // Posts tab = original content only; Reposts tab = reposts (each shows the original author).
  const cond = req.query.type === 'reposts' ? 'repost_of IS NOT NULL' : 'repost_of IS NULL';
  const rows = all(`SELECT * FROM posts WHERE user_id = ? AND team_id IS NULL AND ${cond} ORDER BY id DESC LIMIT 100`, u.id);
  res.json(hydratePosts(rows, req.user.id));
}));

r.get('/users/:id/friends', h((req, res) => {
  const u = get('SELECT id, privacy FROM users WHERE id = ?', Number(req.params.id));
  if (!u || !canViewProfile(req.user.id, u)) return res.json([]);
  res.json(friendIds(u.id).map(publicUser).filter(Boolean));
}));

// ---------- friends ----------
r.get('/friends', h((req, res) => {
  res.json(friendIds(req.user.id).map(publicUser).filter(Boolean).sort((a, b) => a.full_name.localeCompare(b.full_name)));
}));

r.get('/friends/requests', h((req, res) => {
  const me = req.user.id;
  const incoming = all(
    `SELECT f.id AS request_id, f.created_at AS requested_at, ${PUBLIC_COLS.split(', ').map((c) => 'u.' + c).join(', ')}
     FROM friendships f JOIN users u ON u.id = f.requester_id WHERE f.addressee_id = ? AND f.status = 'pending' ORDER BY f.id DESC`, me);
  const outgoing = all(
    `SELECT f.id AS request_id, f.created_at AS requested_at, ${PUBLIC_COLS.split(', ').map((c) => 'u.' + c).join(', ')}
     FROM friendships f JOIN users u ON u.id = f.addressee_id WHERE f.requester_id = ? AND f.status = 'pending' ORDER BY f.id DESC`, me);
  res.json({ incoming, outgoing });
}));

r.get('/friends/suggestions', h((req, res) => {
  const me = req.user.id;
  const mine = new Set(friendIds(me));
  const pending = new Set(
    all('SELECT requester_id a, addressee_id b FROM friendships WHERE requester_id = ? OR addressee_id = ?', me, me).flatMap((x) => [x.a, x.b])
  );
  const mates = new Set(teammateIds(me));
  const candidates = all(`SELECT ${PUBLIC_COLS} FROM users WHERE status = 'active' AND id != ? LIMIT 500`, me)
    .filter((u) => !mine.has(u.id) && !pending.has(u.id))
    .map((u) => {
      const mutual = friendIds(u.id).filter((id) => mine.has(id)).length;
      const sameTeam = mates.has(u.id) ? 1 : 0;
      return { ...u, mutual, sameTeam, score: mutual * 2 + sameTeam * 3 };
    })
    .sort((a, b) => b.score - a.score || a.full_name.localeCompare(b.full_name))
    .slice(0, 20);
  res.json(candidates);
}));

r.post('/friends/:userId/request', h((req, res) => {
  const me = req.user.id;
  const other = Number(req.params.userId);
  if (other === me) fail(400, "You can't add yourself.");
  const u = get("SELECT id FROM users WHERE id = ? AND status = 'active'", other);
  if (!u) fail(404, 'User not found.');
  if (isBlocked(me, other)) fail(403, "You can't send a friend request to this person.");
  const f = friendshipBetween(me, other);
  if (f?.status === 'accepted') fail(409, 'You are already friends.');
  if (f && f.requester_id === other) {
    // They already asked us: accept instead.
    run("UPDATE friendships SET status = 'accepted', accepted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", f.id);
    notify({ userId: other, type: 'friend_accept', actorId: me, entityType: 'user', entityId: me, title: 'Friend request accepted', body: `${req.user.full_name} accepted your friend request.` });
    return res.json({ relation: 'friends' });
  }
  if (f) return res.json({ relation: 'outgoing' });
  const pref = userSettings(other).friend_requests;
  if (pref === 'nobody') fail(403, "This person isn't accepting friend requests.");
  if (pref === 'mutuals' && !friendIds(other).some((id) => friendIds(me).includes(id))) fail(403, 'This person only accepts requests from friends of friends.');
  const rr = run('INSERT INTO friendships (requester_id, addressee_id) VALUES (?, ?)', me, other);
  notify({ userId: other, type: 'friend_request', actorId: me, entityType: 'friend_request', entityId: Number(rr.lastInsertRowid), title: 'New friend request', body: `${req.user.full_name} sent you a friend request.` });
  res.json({ relation: 'outgoing' });
}));

r.post('/friends/:userId/accept', h((req, res) => {
  const me = req.user.id;
  const other = Number(req.params.userId);
  const f = get("SELECT * FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'", other, me);
  if (!f) fail(404, 'No pending request from this user.');
  run("UPDATE friendships SET status = 'accepted', accepted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", f.id);
  notify({ userId: other, type: 'friend_accept', actorId: me, entityType: 'user', entityId: me, title: 'Friend request accepted', body: `${req.user.full_name} accepted your friend request.` });
  run("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND type = 'friend_request' AND entity_id = ?", me, f.id);
  res.json({ relation: 'friends' });
}));

// Decline incoming, cancel outgoing, or unfriend.
r.delete('/friends/:userId', h((req, res) => {
  const f = friendshipBetween(req.user.id, Number(req.params.userId));
  if (f) run('DELETE FROM friendships WHERE id = ?', f.id);
  res.json({ relation: 'none' });
}));

r.get('/friends/check/:userId', h((req, res) => {
  res.json({ friends: areFriends(req.user.id, Number(req.params.userId)) });
}));

// ---------- blocking ----------
r.get('/blocks', h((req, res) => {
  res.json(all('SELECT blocked_id, created_at FROM blocks WHERE blocker_id = ? ORDER BY created_at DESC', req.user.id)
    .map((b) => ({ ...publicUser(b.blocked_id), blocked_at: b.created_at })));
}));
r.post('/users/:id/block', h((req, res) => {
  const other = Number(req.params.id);
  if (other === req.user.id) fail(400, "You can't block yourself.");
  if (!get('SELECT id FROM users WHERE id = ?', other)) fail(404, 'User not found.');
  run('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)', req.user.id, other);
  const f = friendshipBetween(req.user.id, other);
  if (f) run('DELETE FROM friendships WHERE id = ?', f.id);
  res.json({ relation: 'blocked' });
}));
r.delete('/users/:id/block', h((req, res) => {
  run('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', req.user.id, Number(req.params.id));
  res.json({ relation: 'none' });
}));

// ---------- settings ----------
r.get('/users/me/settings', h((req, res) => res.json(userSettings(req.user.id))));
r.patch('/users/me/settings', h((req, res) => {
  const cur = userSettings(req.user.id);
  const b = req.body || {};
  const next = { ...cur };
  if (b.message_privacy !== undefined) { if (!['friends', 'nobody'].includes(b.message_privacy)) fail(400, 'Invalid option.'); next.message_privacy = b.message_privacy; }
  if (b.friend_requests !== undefined) { if (!['everyone', 'mutuals', 'nobody'].includes(b.friend_requests)) fail(400, 'Invalid option.'); next.friend_requests = b.friend_requests; }
  if (b.show_active !== undefined) next.show_active = !!b.show_active;
  if (b.media_autoload !== undefined) next.media_autoload = !!b.media_autoload;
  if (b.location_sharing !== undefined) {
    if (!['friends', 'private'].includes(b.location_sharing)) fail(400, 'Invalid option.');
    next.location_sharing = b.location_sharing;
    // Going private immediately withdraws everything location-related.
    if (b.location_sharing === 'private') {
      run('DELETE FROM user_locations WHERE user_id = ?', req.user.id);
      run("UPDATE trips SET shared = 0 WHERE user_id = ? AND status = 'active'", req.user.id);
    }
  }
  if (b.notify) for (const k of Object.keys(DEFAULT_USER_SETTINGS.notify)) if (b.notify[k] !== undefined) next.notify[k] = !!b.notify[k];
  run('UPDATE users SET settings = ? WHERE id = ?', JSON.stringify(next), req.user.id);
  res.json(next);
}));

// Change email: re-confirm the password, then the new address must be verified again.
r.patch('/users/me/email', h((req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Enter a valid email address.');
  if (!bcrypt.compareSync(String(req.body?.password || ''), req.user.password_hash)) fail(400, 'Password is incorrect.');
  if (email === req.user.email.toLowerCase()) fail(400, 'That is already your email.');
  if (get('SELECT id FROM users WHERE email = ? AND id != ?', email, req.user.id)) fail(409, 'That email is already in use.');
  run('UPDATE users SET email = ?, verified = 0 WHERE id = ?', email, req.user.id);
  res.json(sessionPayload(get('SELECT * FROM users WHERE id = ?', req.user.id), req.app_kind));
}));

r.post('/users/me/deactivate', h((req, res) => {
  if (!bcrypt.compareSync(String(req.body?.password || ''), req.user.password_hash)) fail(400, 'Password is incorrect.');
  run("UPDATE users SET status = 'disabled' WHERE id = ?", req.user.id);
  notifyStaff({ type: 'system', actorId: req.user.id, entityType: 'user', entityId: req.user.id, title: 'Account deactivated', body: `${req.user.full_name} deactivated their account. Reactivate it in User Management if needed.` });
  res.json({ ok: true });
}));

// Storage used by the media this user uploaded.
r.get('/users/me/storage', h((req, res) => {
  const me = req.user.id;
  const size = (urls) => urls.filter(Boolean).reduce((a, u) => {
    try { return a + fs.statSync(path.join(UPLOAD_DIR, path.basename(u))).size; } catch { return a; }
  }, 0);
  const attach = all('SELECT attachment FROM messages WHERE sender_id = ? AND attachment IS NOT NULL', me).map((m) => { try { return JSON.parse(m.attachment).url; } catch { return null; } });
  res.json({
    posts: size(all('SELECT i.url FROM post_images i JOIN posts p ON p.id = i.post_id WHERE p.user_id = ?', me).map((x) => x.url)),
    stories: size(all('SELECT image FROM stories WHERE user_id = ?', me).map((x) => x.image)),
    chats: size([...all('SELECT image FROM messages WHERE sender_id = ?', me).map((x) => x.image), ...attach]),
    comments: size(all('SELECT image FROM comments WHERE user_id = ?', me).map((x) => x.image)),
    profile: size([req.user.avatar]),
  });
}));

// ---------- reports & support ----------
r.post('/reports', h((req, res) => {
  const { target_type = '', target_id = null, reason = '' } = req.body || {};
  if (!['user', 'conversation', 'post', 'story', 'comment'].includes(target_type)) fail(400, 'Invalid report.');
  if (!String(reason).trim()) fail(400, 'Tell us what is wrong.');
  const id = Number(run('INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?, ?, ?, ?)', req.user.id, target_type, Number(target_id) || null, String(reason).slice(0, 1000)).lastInsertRowid);
  notifyStaff({ type: 'report', actorId: req.user.id, entityType: 'report', entityId: id, title: `New ${target_type} report`, body: `${req.user.full_name}: ${String(reason).slice(0, 200)}` });
  res.status(201).json({ ok: true });
}));
r.post('/support', h((req, res) => {
  const { subject = '', message = '' } = req.body || {};
  if (!String(subject).trim() || !String(message).trim()) fail(400, 'Add a subject and a message.');
  const id = Number(run("INSERT INTO reports (reporter_id, target_type, subject, reason) VALUES (?, 'support', ?, ?)", req.user.id, String(subject).slice(0, 150), String(message).slice(0, 2000)).lastInsertRowid);
  notifyStaff({ roles: ['developer', 'sysadmin', 'support'], type: 'support', actorId: req.user.id, entityType: 'support', entityId: id, title: `Support: ${String(subject).slice(0, 80)}`, body: `${req.user.full_name} (${req.user.email}): ${String(message).slice(0, 300)}` });
  res.status(201).json({ ok: true });
}));

export default r;
