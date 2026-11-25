import { Router } from 'express';
import { get, all, run, tx, userSettings } from '../db.js';
import { auth } from '../auth.js';
import { h, fail, imageUpload, fileUpload, fileUrl, deleteStoredFiles, attachmentUrls, publicUser, areFriends, isBlocked, nowIso, localDay, addDays, canViewProfile } from '../util.js';
import { emitToUsers, isOnline } from '../realtime.js';
import { notifyMessage } from '../notify.js';
import { hydratePost } from './posts.js';
import { canManageTeam, canAccessTeam, teamRow } from '../teams.js';

const r = Router();
r.use(auth());

// Online dot only when the person allows showing their active status.
const onlineFor = (uid) => isOnline(uid) && userSettings(uid).show_active;
const memberIds = (cid) => all('SELECT user_id FROM conversation_members WHERE conversation_id = ?', cid).map((m) => m.user_id);
const membership = (cid, uid) => get('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?', cid, uid);

function requireMember(cid, uid) {
  const conv = get('SELECT * FROM conversations WHERE id = ?', Number(cid));
  if (!conv) fail(404, 'Chat not found.');
  const m = membership(conv.id, uid);
  if (!m) fail(403, 'You are not a member of this chat.');
  return { conv, member: m };
}
function requireGroupAdmin(cid, uid) {
  const x = requireMember(cid, uid);
  if (x.conv.type !== 'group') fail(400, 'Only group chats have settings.');
  // Team channels are run by the team's owner, managers and team leaders.
  if (x.conv.team_id ? !canManageTeam(uid, x.conv.team_id) : x.member.role !== 'admin') fail(403, 'Only group admins can change group settings.');
  return x;
}

/**
 * Chat streak: consecutive days (ending today or yesterday) on which the chat had
 * two-way interaction, i.e. at least two different members sent a message.
 */
export function streakFor(cid) {
  const days = all(
    `SELECT date(created_at, 'localtime') d, COUNT(DISTINCT sender_id) c FROM messages
     WHERE conversation_id = ? AND kind = 'text' AND deleted = 0 AND created_at > ?
     GROUP BY d HAVING c >= 2`,
    cid, new Date(Date.now() - 400 * 864e5).toISOString()
  ).map((x) => x.d);
  const set = new Set(days);
  let day = localDay();
  if (!set.has(day)) day = addDays(day, -1);
  let n = 0;
  while (set.has(day)) {
    n += 1;
    day = addDays(day, -1);
  }
  return n;
}

export function messageOut(m, viewerId) {
  if (!m) return null;
  const reactions = all('SELECT user_id, emoji FROM message_reactions WHERE message_id = ?', m.id);
  const out = {
    ...m,
    text: m.deleted ? '' : m.text,
    image: m.deleted ? null : m.image,
    attachment: m.deleted || !m.attachment ? null : JSON.parse(m.attachment),
    note_ref: m.deleted || !m.note_ref ? null : JSON.parse(m.note_ref),
    sender: m.sender_id ? publicUser(m.sender_id) : null,
    reactions,
  };
  if (m.shared_post_id && !m.deleted) out.shared_post = hydratePost(get('SELECT * FROM posts WHERE id = ?', m.shared_post_id), viewerId, 1) || { unavailable: true };
  if (m.story_id && !m.deleted) {
    const st = get('SELECT id, user_id, image, text, mood, theme, expires_at FROM stories WHERE id = ?', m.story_id);
    out.story = st ? { ...st, expired: st.expires_at < nowIso() } : { unavailable: true };
  }
  // Shared highlight card: re-checked against the viewer's access to the owner's profile.
  if (m.highlight_id && !m.deleted) {
    const hl = get('SELECT h.id, h.title, h.user_id, h.cover_image, h.cover_emoji FROM highlights h WHERE h.id = ?', m.highlight_id);
    const owner = hl && get('SELECT id, privacy FROM users WHERE id = ?', hl.user_id);
    if (hl && canViewProfile(viewerId, owner)) {
      const first = get('SELECT s.image, s.theme, s.mood FROM highlight_items i JOIN stories s ON s.id = i.story_id WHERE i.highlight_id = ? ORDER BY s.id LIMIT 1', hl.id);
      out.highlight = { ...hl, owner: publicUser(hl.user_id), cover: hl.cover_image || (hl.cover_emoji ? null : first?.image || null), theme: first?.theme, mood: first?.mood,
        count: get('SELECT COUNT(*) c FROM highlight_items WHERE highlight_id = ?', hl.id).c };
    } else out.highlight = { unavailable: true };
  }
  if (m.reply_to) {
    const rep = get('SELECT id, sender_id, text, image, deleted FROM messages WHERE id = ?', m.reply_to);
    if (rep) out.reply = { id: rep.id, text: rep.deleted ? 'Message unsent' : rep.text, image: !!rep.image, sender: publicUser(rep.sender_id)?.full_name };
  }
  return out;
}

function conversationOut(conv, me) {
  const members = all(
    `SELECT m.user_id, m.role, m.last_read_id FROM conversation_members m WHERE m.conversation_id = ?`, conv.id
  ).map((m) => ({ ...publicUser(m.user_id), member_role: m.role, last_read_id: m.last_read_id, online: onlineFor(m.user_id) }));
  const mine = members.find((m) => m.id === me);
  const last = get('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1', conv.id);
  const unread = get('SELECT COUNT(*) c FROM messages WHERE conversation_id = ? AND id > ? AND (sender_id IS NULL OR sender_id != ?)', conv.id, mine?.last_read_id || 0, me).c;
  const other = conv.type === 'direct' ? members.find((m) => m.id !== me) : null;
  const team = conv.team_id ? teamRow(conv.team_id) : null;
  return {
    ...conv,
    team: team && { id: team.id, name: team.name, logo: team.logo },
    title: conv.type === 'group' ? conv.name : other?.full_name || 'Chat',
    avatar: conv.type === 'group' ? conv.photo : other?.avatar,
    other,
    members,
    my_role: mine?.member_role, // role in this chat (admin | member), not the account role
    muted: !!get('SELECT muted FROM conversation_members WHERE conversation_id = ? AND user_id = ?', conv.id, me)?.muted,
    archived: !!get('SELECT archived FROM conversation_members WHERE conversation_id = ? AND user_id = ?', conv.id, me)?.archived,
    blocked: conv.type === 'direct' && other ? isBlocked(me, other.id) : false,
    unread,
    streak: streakFor(conv.id),
    last_message: last ? {
      id: last.id,
      text: last.deleted ? 'Message unsent' : last.text || (last.image ? '📷 Photo' : last.attachment ? '📎 Attachment' : last.story_id ? 'Replied to a story' : last.shared_post_id ? '🔗 Shared a post' : last.highlight_id ? '✨ Shared a highlight' : ''),
      sender_id: last.sender_id,
      sender_name: publicUser(last.sender_id)?.full_name?.split(' ')[0],
      kind: last.kind,
      created_at: last.created_at,
    } : null,
  };
}

/** Create a message and fan it out over sockets + notifications. Used by posts sharing too. */
export function postMessage({ conversationId, sender, text = '', image = null, attachment = null, storyId = null, sharedPostId = null, highlightId = null, noteRef = null, replyTo = null, kind = 'text' }) {
  const { conv } = kind === 'system' ? { conv: get('SELECT * FROM conversations WHERE id = ?', conversationId) } : requireMember(conversationId, sender.id);
  if (conv.type === 'direct' && kind === 'text') {
    const other = memberIds(conv.id).find((id) => id !== sender.id);
    if (other && isBlocked(sender.id, other)) fail(403, 'You can\'t message this person.');
    if (other && !areFriends(sender.id, other)) fail(403, 'You can only message friends.');
    if (other && userSettings(other).message_privacy === 'nobody') fail(403, `${publicUser(other).full_name.split(' ')[0]} isn\'t accepting messages right now.`);
  }
  const id = Number(run(
    'INSERT INTO messages (conversation_id, sender_id, kind, text, image, attachment, story_id, shared_post_id, highlight_id, note_ref, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    conv.id, kind === 'system' ? sender?.id || null : sender.id, kind, text, image, attachment ? JSON.stringify(attachment) : null, storyId, sharedPostId, highlightId, noteRef ? JSON.stringify(noteRef) : null, replyTo
  ).lastInsertRowid);
  run('UPDATE conversations SET updated_at = ? WHERE id = ?', nowIso(), conv.id);
  // A new message brings an archived chat back for everyone.
  if (kind === 'text') run('UPDATE conversation_members SET archived = 0 WHERE conversation_id = ?', conv.id);
  if (kind === 'text') run('UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?', id, conv.id, sender.id);
  const members = memberIds(conv.id);
  members.forEach((uid) => {
    emitToUsers([uid], 'message:new', { conversationId: conv.id, message: messageOut(get('SELECT * FROM messages WHERE id = ?', id), uid) });
  });
  if (kind === 'text') {
    const preview = text ? text.slice(0, 80) : image ? '📷 Photo' : attachment ? `📎 ${attachment.name}` : highlightId ? '✨ Shared a highlight' : '🔗 Shared a post';
    members.filter((uid) => uid !== sender.id && !membership(conv.id, uid)?.muted).forEach((uid) =>
      notifyMessage({
        userId: uid, actorId: sender.id, conversationId: conv.id,
        title: conv.type === 'group' ? conv.name : sender.full_name,
        body: conv.type === 'group' ? `${sender.full_name.split(' ')[0]}: ${preview}` : preview,
      })
    );
  }
  return id;
}

// ---------- conversations ----------
r.get('/conversations', h((req, res) => {
  const me = req.user.id;
  const convs = all(
    `SELECT c.* FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id
     WHERE m.user_id = ? ORDER BY c.updated_at DESC`, me
  );
  // Hide empty direct chats from the list. Personal chats and team channels are listed separately.
  const archived = req.query.archived === '1';
  const teams = req.query.scope === 'teams';
  res.json(convs
    .filter((c) => (teams ? !!c.team_id && canAccessTeam(me, c.team_id) : !c.team_id))
    .map((c) => conversationOut(c, me)).filter((c) => (c.type === 'group' || c.last_message) && (teams || c.archived === archived)));
}));

r.post('/conversations/direct', h((req, res) => {
  const me = req.user.id;
  const other = Number(req.body?.userId);
  if (!other || other === me) fail(400, 'Choose someone to message.');
  if (isBlocked(me, other)) fail(403, 'You can\'t message this person.');
  if (!areFriends(me, other)) fail(403, 'Messaging is available once your friend request is accepted.');
  const key = [me, other].sort((a, b) => a - b).join(':');
  let conv = get('SELECT * FROM conversations WHERE direct_key = ?', key);
  if (!conv) {
    tx(() => {
      const id = Number(run("INSERT INTO conversations (type, direct_key, created_by) VALUES ('direct', ?, ?)", key, me).lastInsertRowid);
      run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', id, me);
      run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', id, other);
    });
    conv = get('SELECT * FROM conversations WHERE direct_key = ?', key);
  }
  res.json(conversationOut(conv, me));
}));

r.post('/conversations/group', h((req, res) => {
  const me = req.user.id;
  const name = String(req.body?.name || '').trim().slice(0, 60);
  const ids = [...new Set((req.body?.memberIds || []).map(Number))].filter((id) => id && id !== me);
  if (!name) fail(400, 'Give the group a name.');
  if (ids.length < 1) fail(400, 'Add at least one member.');
  if (ids.some((id) => !areFriends(me, id))) fail(403, 'You can only add friends to a group.');
  const id = tx(() => {
    const id = Number(run("INSERT INTO conversations (type, name, created_by) VALUES ('group', ?, ?)", name, me).lastInsertRowid);
    run("INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'admin')", id, me);
    ids.forEach((uid) => run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', id, uid));
    return id;
  });
  postMessage({ conversationId: id, sender: req.user, text: `${req.user.full_name} created the group "${name}"`, kind: 'system' });
  const conv = get('SELECT * FROM conversations WHERE id = ?', id);
  emitToUsers(memberIds(id), 'conversation:update', { id });
  res.status(201).json(conversationOut(conv, me));
}));

r.get('/conversations/:id', h((req, res) => {
  const { conv } = requireMember(req.params.id, req.user.id);
  res.json(conversationOut(conv, req.user.id));
}));

r.patch('/conversations/:id', h((req, res) => {
  const { conv } = requireGroupAdmin(req.params.id, req.user.id);
  if (req.body?.description !== undefined) run('UPDATE conversations SET description = ? WHERE id = ?', String(req.body.description).trim().slice(0, 300), conv.id);
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim().slice(0, 60);
    if (!name) fail(400, 'Name cannot be empty.');
    if (name !== conv.name) {
      run('UPDATE conversations SET name = ? WHERE id = ?', name, conv.id);
      postMessage({ conversationId: conv.id, sender: req.user, text: `${req.user.full_name} renamed the group to "${name}"`, kind: 'system' });
    }
  }
  emitToUsers(memberIds(conv.id), 'conversation:update', { id: conv.id });
  res.json(conversationOut(get('SELECT * FROM conversations WHERE id = ?', conv.id), req.user.id));
}));

r.post('/conversations/:id/photo', imageUpload.single('photo'), h((req, res) => {
  const { conv } = requireGroupAdmin(req.params.id, req.user.id);
  if (!req.file) fail(400, 'Choose an image.');
  run('UPDATE conversations SET photo = ? WHERE id = ?', fileUrl(req.file), conv.id);
  deleteStoredFiles(conv.photo);
  postMessage({ conversationId: conv.id, sender: req.user, text: `${req.user.full_name} changed the group photo`, kind: 'system' });
  emitToUsers(memberIds(conv.id), 'conversation:update', { id: conv.id });
  res.json(conversationOut(get('SELECT * FROM conversations WHERE id = ?', conv.id), req.user.id));
}));

const teamManaged = (conv) => { if (conv.team_id) fail(400, 'Team channel members follow the team. Manage people from the team in Work.'); };

r.post('/conversations/:id/members', h((req, res) => {
  const { conv } = requireGroupAdmin(req.params.id, req.user.id);
  teamManaged(conv);
  const ids = (req.body?.userIds || []).map(Number).filter((id) => !membership(conv.id, id));
  if (!ids.length) fail(400, 'Choose people to add.');
  if (ids.some((id) => !areFriends(req.user.id, id))) fail(403, 'You can only add your friends.');
  ids.forEach((uid) => {
    run('INSERT INTO conversation_members (conversation_id, user_id, last_read_id) VALUES (?, ?, 0)', conv.id, uid);
    postMessage({ conversationId: conv.id, sender: req.user, text: `${req.user.full_name} added ${publicUser(uid).full_name}`, kind: 'system' });
  });
  emitToUsers(memberIds(conv.id), 'conversation:update', { id: conv.id });
  res.json(conversationOut(conv, req.user.id));
}));

// Admins remove members; any member can remove themselves (leave).
r.delete('/conversations/:id/members/:userId', h((req, res) => {
  const target = Number(req.params.userId);
  const { conv, member } = requireMember(req.params.id, req.user.id);
  if (conv.type !== 'group') fail(400, 'Not a group chat.');
  teamManaged(conv);
  if (target !== req.user.id && member.role !== 'admin') fail(403, 'Only group admins can remove members.');
  if (!membership(conv.id, target)) fail(404, 'Not a member.');
  const before = memberIds(conv.id);
  run('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', conv.id, target);
  const name = publicUser(target).full_name;
  postMessage({ conversationId: conv.id, sender: req.user, text: target === req.user.id ? `${name} left the group` : `${req.user.full_name} removed ${name}`, kind: 'system' });
  // Keep at least one admin.
  const left = all('SELECT * FROM conversation_members WHERE conversation_id = ? ORDER BY joined_at', conv.id);
  if (left.length && !left.some((m) => m.role === 'admin')) run("UPDATE conversation_members SET role = 'admin' WHERE conversation_id = ? AND user_id = ?", conv.id, left[0].user_id);
  if (!left.length) {
    const msgs = all('SELECT image, attachment FROM messages WHERE conversation_id = ? AND (image IS NOT NULL OR attachment IS NOT NULL)', conv.id);
    run('DELETE FROM conversations WHERE id = ?', conv.id);
    deleteStoredFiles(conv.photo, msgs.map((x) => x.image), msgs.map((x) => attachmentUrls(x.attachment)));
  }
  emitToUsers(before, 'conversation:update', { id: conv.id });
  res.json({ ok: true });
}));

r.post('/conversations/:id/admins/:userId', h((req, res) => {
  const { conv } = requireGroupAdmin(req.params.id, req.user.id);
  teamManaged(conv);
  const target = membership(conv.id, Number(req.params.userId));
  if (!target) fail(404, 'Not a member.');
  const role = target.role === 'admin' ? 'member' : 'admin';
  if (role === 'member' && get("SELECT COUNT(*) c FROM conversation_members WHERE conversation_id = ? AND role = 'admin'", conv.id).c <= 1) fail(400, 'A group needs at least one admin.');
  run('UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?', role, conv.id, target.user_id);
  emitToUsers(memberIds(conv.id), 'conversation:update', { id: conv.id });
  res.json(conversationOut(conv, req.user.id));
}));

// ---------- messages ----------
r.get('/conversations/:id/messages', h((req, res) => {
  const { conv } = requireMember(req.params.id, req.user.id);
  const before = Number(req.query.before) || 1e15;
  const rows = all('SELECT * FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT 40', conv.id, before).reverse();
  res.json({ messages: rows.map((m) => messageOut(m, req.user.id)), hasMore: rows.length === 40 });
}));

// Images go inline; videos and other files are sent as attachments (up to 15 MB).
r.post('/conversations/:id/messages', fileUpload.single('file'), h((req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 4000);
  const sharedPostId = Number(req.body?.shared_post_id) || null;
  const f = req.file;
  if (!text && !f && !sharedPostId) fail(400, 'Message is empty.');
  const isImage = f && /^image\/(png|jpe?g|gif|webp|avif|heic|heif)$/.test(f.mimetype);
  const attachment = f && !isImage ? { url: fileUrl(f), name: f.originalname.slice(0, 120), type: f.mimetype, size: f.size } : null;
  const id = postMessage({
    conversationId: Number(req.params.id), sender: req.user, text, image: isImage ? fileUrl(f) : null, attachment, sharedPostId, replyTo: Number(req.body?.reply_to) || null,
  });
  res.status(201).json(messageOut(get('SELECT * FROM messages WHERE id = ?', id), req.user.id));
}));

r.post('/conversations/:id/read', h((req, res) => {
  const { conv } = requireMember(req.params.id, req.user.id);
  const last = get('SELECT MAX(id) m FROM messages WHERE conversation_id = ?', conv.id).m || 0;
  run('UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ? AND last_read_id < ?', last, conv.id, req.user.id, last);
  run("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND type = 'message' AND entity_id = ?", req.user.id, conv.id);
  emitToUsers(memberIds(conv.id), 'message:read', { conversationId: conv.id, userId: req.user.id, lastReadId: last });
  res.json({ lastReadId: last });
}));

r.get('/conversations/:id/media', h((req, res) => {
  const { conv } = requireMember(req.params.id, req.user.id);
  const kind = req.query.kind || 'photos';
  if (kind === 'photos') return res.json(all('SELECT id, image, sender_id, created_at FROM messages WHERE conversation_id = ? AND image IS NOT NULL AND deleted = 0 ORDER BY id DESC', conv.id));
  if (kind === 'links') {
    const rows = all("SELECT id, text, sender_id, created_at FROM messages WHERE conversation_id = ? AND deleted = 0 AND kind = 'text' AND (text LIKE '%http://%' OR text LIKE '%https://%') ORDER BY id DESC", conv.id);
    return res.json(rows.flatMap((m) => (m.text.match(/https?:\/\/[^\s]+/g) || []).map((url) => ({ id: m.id, url, sender: publicUser(m.sender_id)?.full_name, created_at: m.created_at }))));
  }
  const rows = all('SELECT id, attachment, sender_id, created_at FROM messages WHERE conversation_id = ? AND attachment IS NOT NULL AND deleted = 0 ORDER BY id DESC', conv.id)
    .map((m) => ({ ...m, attachment: JSON.parse(m.attachment), sender: publicUser(m.sender_id)?.full_name }));
  res.json(rows.filter((m) => (kind === 'videos') === m.attachment.type.startsWith('video/')));
}));

r.get('/conversations/:id/shared', h((req, res) => {
  const { conv } = requireMember(req.params.id, req.user.id);
  res.json(all('SELECT * FROM messages WHERE conversation_id = ? AND shared_post_id IS NOT NULL AND deleted = 0 ORDER BY id DESC LIMIT 100', conv.id).map((m) => messageOut(m, req.user.id)));
}));

r.get('/conversations/:id/search', h((req, res) => {
  const { conv } = requireMember(req.params.id, req.user.id);
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  res.json(all("SELECT * FROM messages WHERE conversation_id = ? AND kind = 'text' AND deleted = 0 AND text LIKE ? ORDER BY id DESC LIMIT 50", conv.id, `%${q}%`).map((m) => messageOut(m, req.user.id)));
}));

// Per-person chat options.
for (const col of ['muted', 'archived']) {
  r.post(`/conversations/:id/${col === 'muted' ? 'mute' : 'archive'}`, h((req, res) => {
    const { conv, member } = requireMember(req.params.id, req.user.id);
    const v = member[col] ? 0 : 1;
    run(`UPDATE conversation_members SET ${col} = ? WHERE conversation_id = ? AND user_id = ?`, v, conv.id, req.user.id);
    res.json({ [col]: !!v });
  }));
}

r.get('/conversations/:id/pinned', h((req, res) => {
  const { conv } = requireMember(req.params.id, req.user.id);
  res.json(all('SELECT * FROM messages WHERE conversation_id = ? AND pinned = 1 AND deleted = 0 ORDER BY id DESC', conv.id).map((m) => messageOut(m, req.user.id)));
}));

const ownMessage = (id, uid) => {
  const m = get('SELECT * FROM messages WHERE id = ?', Number(id));
  if (!m) fail(404, 'Message not found.');
  requireMember(m.conversation_id, uid);
  return m;
};
const broadcastUpdate = (m) => {
  memberIds(m.conversation_id).forEach((uid) =>
    emitToUsers([uid], 'message:update', { conversationId: m.conversation_id, message: messageOut(get('SELECT * FROM messages WHERE id = ?', m.id), uid) })
  );
};

r.post('/messages/:id/pin', h((req, res) => {
  const m = ownMessage(req.params.id, req.user.id);
  if (m.kind === 'system' || m.deleted) fail(400, "This message can't be pinned.");
  run('UPDATE messages SET pinned = ?, pinned_by = ? WHERE id = ?', m.pinned ? 0 : 1, req.user.id, m.id);
  if (!m.pinned) postMessage({ conversationId: m.conversation_id, sender: req.user, text: `${req.user.full_name} pinned a message`, kind: 'system' });
  broadcastUpdate(m);
  res.json({ pinned: !m.pinned });
}));

r.post('/messages/:id/react', h((req, res) => {
  const m = ownMessage(req.params.id, req.user.id);
  const emoji = String(req.body?.emoji || '').slice(0, 8);
  const cur = get('SELECT emoji FROM message_reactions WHERE message_id = ? AND user_id = ?', m.id, req.user.id);
  if (!emoji || cur?.emoji === emoji) run('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?', m.id, req.user.id);
  else run('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?) ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji', m.id, req.user.id, emoji);
  broadcastUpdate(m);
  res.json({ ok: true });
}));

r.delete('/messages/:id', h((req, res) => {
  const m = ownMessage(req.params.id, req.user.id);
  if (m.sender_id !== req.user.id) fail(403, 'You can only unsend your own messages.');
  run('UPDATE messages SET deleted = 1, pinned = 0, image = NULL, attachment = NULL WHERE id = ?', m.id);
  deleteStoredFiles(m.image, attachmentUrls(m.attachment)); // unsent photos and files are deleted permanently
  broadcastUpdate(m);
  res.json({ ok: true });
}));

export { memberIds };
export default r;
