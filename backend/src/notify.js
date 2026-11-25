import { run, get, all, userSettings } from './db.js';
import { emitToUser } from './realtime.js';

const PREF_FOR = {
  like: 'likes', story_reaction: 'likes', comment_reaction: 'likes',
  comment: 'comments', reply: 'comments', mention: 'comments', story_comment: 'comments',
  message: 'messages', friend_request: 'friend_requests', friend_accept: 'friend_requests', app_update: 'app_updates',
  trip: 'trips', work_post: 'work', work_announcement: 'work', schedule: 'work', post_permission: 'work',
};

export function notify({ userId, audience = 'client', type, actorId = null, entityType = null, entityId = null, title = '', body = '', data = null }) {
  if (!userId || (actorId && actorId === userId && audience === 'client')) return null;
  // Respect the recipient's in-app notification preferences.
  const pref = PREF_FOR[type];
  if (audience === 'client' && pref && userSettings(userId).notify[pref] === false) return null;
  const r = run(
    `INSERT INTO notifications (user_id, audience, type, actor_id, entity_type, entity_id, title, body, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, audience, type, actorId, entityType, entityId, title, body, data ? JSON.stringify(data) : null
  );
  const n = notificationById(Number(r.lastInsertRowid));
  emitToUser(userId, 'notification:new', n);
  return n;
}

// Collapse repeated message notifications for the same conversation into one unread row.
export function notifyMessage({ userId, actorId, conversationId, title, body }) {
  const existing = get(
    `SELECT id FROM notifications WHERE user_id = ? AND audience = 'client' AND type = 'message' AND entity_id = ? AND is_read = 0`,
    userId, conversationId
  );
  if (existing) {
    run(`UPDATE notifications SET actor_id = ?, title = ?, body = ?, created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, actorId, title, body, existing.id);
    const n = notificationById(existing.id);
    emitToUser(userId, 'notification:new', n);
    return n;
  }
  return notify({ userId, type: 'message', actorId, entityType: 'conversation', entityId: conversationId, title, body });
}

export function notificationById(id) {
  const n = get(
    `SELECT n.*, u.full_name AS actor_name, u.avatar AS actor_avatar
     FROM notifications n LEFT JOIN users u ON u.id = n.actor_id WHERE n.id = ?`,
    id
  );
  if (n?.data) n.data = JSON.parse(n.data);
  return n;
}

// Notify staff members (admin dashboard audience). `roles` limits recipients.
export function notifyStaff({ roles = ['developer', 'sysadmin', 'support'], ...rest }) {
  const ph = roles.map(() => '?').join(',');
  const staff = all(`SELECT id FROM users WHERE status = 'active' AND role IN (${ph})`, ...roles);
  staff.forEach((s) => notify({ ...rest, userId: s.id, audience: 'admin' }));
}
