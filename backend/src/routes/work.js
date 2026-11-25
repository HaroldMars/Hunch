import { Router } from 'express';
import { MOODS, moodByKey } from '../../../shared/constants.js';
import { get, all, run, tx, newInviteCode } from '../db.js';
import { auth } from '../auth.js';
import { h, fail, imageUpload, fileUrl, publicUser, selfUser, nowIso, localDay, addDays, deleteStoredFiles, areFriends } from '../util.js';
import { notify } from '../notify.js';
import { sendTeamInvite } from '../mailer.js';
import { emitToUsers } from '../realtime.js';
import { hydratePosts, hydratePost } from './posts.js';
import { storyOut } from './stories.js';
import { POSITIVE, LOW_ENERGY, NEGATIVE } from '../analytics.js';
import {
  workTeams, memberRole, canAccessTeam, canManageTeam, isTeamOwner, canInvite, canPostInTeam, teamSettings, teamMemberIds, resolveTeam, teamRow,
} from '../teams.js';

const r = Router();
r.use(auth());

export const SCHEDULE_KINDS = ['shift', 'rest', 'lunch', 'meeting', 'overtime', 'coaching', 'training'];
const KIND_LABEL = { shift: 'Shift', rest: 'Rest day', lunch: 'Lunch', meeting: 'Meeting', overtime: 'Overtime', coaching: 'Coaching session', training: 'Training' };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_ORDER = ['owner', 'admin', 'member'];

/** The team this request is about; the user must be a member. */
function team(req, source = req.query) {
  const t = resolveTeam(req.user, source?.team);
  if (!t) fail(404, source?.team ? 'You are not a member of that team.' : 'You are not on a team yet. Create one or accept an invitation.');
  return t;
}
const mustManage = (req, t) => { if (!canManageTeam(req.user, t)) fail(403, 'Only team owners and admins can do that.'); };
const mustOwn = (req, t) => { if (!isTeamOwner(req.user, t)) fail(403, 'Only the team owner can do that.'); };
const activeTeamOr404 = (id) => {
  const t = get("SELECT * FROM teams WHERE id = ? AND status = 'active'", Number(id));
  if (!t) fail(404, 'Team not found.');
  return t;
};

/** A team as its members see it. Nothing here is ever shown outside the team. */
function teamOut(t, me) {
  const row = typeof t === 'object' ? t : teamRow(t);
  if (!row) return null;
  return {
    id: row.id, name: row.name, description: row.description, logo: row.logo, color: row.color,
    members: teamMemberIds(row.id).length, owner: row.owner_id ? publicUser(row.owner_id) : null,
    my_role: memberRole(me, row.id), created_at: row.created_at,
    invite_code: canInvite(me, row.id) ? row.invite_code : undefined,
  };
}
const fanout = (teamId, exceptId, payload) => teamMemberIds(teamId).filter((id) => id !== exceptId).forEach((uid) => notify({ ...payload, userId: uid }));
const managerIds = (teamId) => all("SELECT user_id FROM team_members WHERE team_id = ? AND role IN ('owner','admin')", teamId).map((m) => m.user_id);

// ---------- team channels (group chats that belong to a team) ----------
// Every member is in every channel; owners and admins are channel admins.
const channelIds = (teamId) => all('SELECT id FROM conversations WHERE team_id = ?', teamId).map((c) => c.id);
const convRole = (teamRole) => (teamRole === 'member' ? 'member' : 'admin');
function syncChannels(teamId, userId, teamRoleOrNull) {
  for (const cid of channelIds(teamId)) {
    if (!teamRoleOrNull) run('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', cid, userId);
    else run(`INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)
             ON CONFLICT(conversation_id, user_id) DO UPDATE SET role = excluded.role`, cid, userId, convRole(teamRoleOrNull));
    emitToUsers([userId], 'conversation:update', { id: cid });
  }
}
function createChannel(teamId, name, by) {
  const cid = Number(run("INSERT INTO conversations (type, name, created_by, team_id) VALUES ('group', ?, ?, ?)", name, by, teamId).lastInsertRowid);
  all('SELECT user_id, role FROM team_members WHERE team_id = ?', teamId)
    .forEach((m) => run('INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)', cid, m.user_id, convRole(m.role)));
  return cid;
}
function addMember(teamId, userId, role = 'member') {
  run('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT(team_id, user_id) DO NOTHING', teamId, userId, role);
  run('UPDATE users SET work_mode = 1 WHERE id = ?', userId);
  syncChannels(teamId, userId, memberRole(userId, teamId));
}
function removeMember(teamId, userId) {
  run('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', teamId, userId);
  syncChannels(teamId, userId, null);
}

// ---------- Work Mode ----------
r.patch('/work/mode', h((req, res) => {
  const on = req.body?.on ? 1 : 0;
  run('UPDATE users SET work_mode = ? WHERE id = ?', on, req.user.id);
  res.json({ work_mode: on, user: selfUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
}));

// ---------- context ----------
r.get('/work/context', h((req, res) => {
  const teams = workTeams(req.user).map((t) => teamOut(t, req.user));
  const invites = myInvites(req.user).length;
  const t = resolveTeam(req.user, req.query.team);
  if (!t) return res.json({ team: null, teams, invites });
  const s = teamSettings(t);
  res.json({
    team: teamOut(t, req.user),
    teams,
    invites,
    role: memberRole(req.user, t),
    canManage: canManageTeam(req.user, t),
    isOwner: isTeamOwner(req.user, t),
    canPost: canPostInTeam(req.user, t),
    canInvite: canInvite(req.user, t),
    canSeeMood: canManageTeam(req.user, t),
    settings: { members_can_post: !!s.members_can_post, members_can_invite: !!teamRow(t).members_can_invite },
  });
}));

// ---------- teams ----------
const readTeamFields = (b) => ({
  name: b.name === undefined ? undefined : String(b.name).trim().slice(0, 60),
  description: b.description === undefined ? undefined : String(b.description).trim().slice(0, 300),
});
const flag = (v) => (v === undefined ? undefined : ['1', 'true', true, 1, 'on'].includes(v) ? 1 : 0);

r.post('/work/teams', imageUpload.single('logo'), h((req, res) => {
  const b = req.body || {};
  const { name, description = '' } = readTeamFields(b);
  if (!name) fail(400, 'Give your team a name.');
  const owned = get("SELECT COUNT(*) c FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? AND m.role = 'owner' AND t.status = 'active'", req.user.id).c;
  if (owned >= 20) fail(400, 'You can own up to 20 teams.');
  const id = tx(() => {
    const id = Number(run('INSERT INTO teams (name, description, logo, owner_id, created_by, invite_code, members_can_invite, department) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      name, description, fileUrl(req.file), req.user.id, req.user.id, newInviteCode(), flag(b.members_can_invite) ?? 0, '').lastInsertRowid);
    run('INSERT INTO team_settings (team_id, members_can_post) VALUES (?, ?)', id, flag(b.members_can_post) ?? 1);
    run("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'owner')", id, req.user.id);
    createChannel(id, 'general', req.user.id);
    run('UPDATE users SET work_mode = 1 WHERE id = ?', req.user.id);
    return id;
  });
  res.status(201).json(teamOut(id, req.user));
}));

// Owner: name, description, logo. Owner or admin: team settings.
r.patch('/work/teams/:id', imageUpload.single('logo'), h((req, res) => {
  const t = activeTeamOr404(req.params.id);
  mustManage(req, t.id);
  const b = req.body || {};
  const f = readTeamFields(b);
  if (f.name !== undefined || f.description !== undefined || req.file || b.remove_logo) {
    mustOwn(req, t.id);
    if (f.name !== undefined && !f.name) fail(400, 'Team name cannot be empty.');
    run('UPDATE teams SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?', f.name ?? null, f.description ?? null, t.id);
    if (req.file || b.remove_logo) {
      run('UPDATE teams SET logo = ? WHERE id = ?', fileUrl(req.file), t.id);
      deleteStoredFiles(t.logo);
    }
  }
  const post = flag(b.members_can_post);
  if (post !== undefined) run('INSERT INTO team_settings (team_id, members_can_post) VALUES (?, ?) ON CONFLICT(team_id) DO UPDATE SET members_can_post = excluded.members_can_post', t.id, post);
  const inv = flag(b.members_can_invite);
  if (inv !== undefined) run('UPDATE teams SET members_can_invite = ? WHERE id = ?', inv, t.id);
  res.json(teamOut(t.id, req.user));
}));

r.delete('/work/teams/:id', h((req, res) => {
  const t = activeTeamOr404(req.params.id);
  mustOwn(req, t.id);
  const members = teamMemberIds(t.id);
  const channels = channelIds(t.id);
  tx(() => {
    run('DELETE FROM stories WHERE team_id = ?', t.id);
    run('DELETE FROM teams WHERE id = ?', t.id); // cascades: members, invites, channels, work posts, schedules
  });
  deleteStoredFiles(t.logo);
  channels.forEach((cid) => emitToUsers(members, 'conversation:update', { id: cid }));
  members.filter((id) => id !== req.user.id).forEach((uid) => notify({ userId: uid, type: 'team', actorId: req.user.id, title: 'Team deleted', body: `${req.user.full_name} deleted the team “${t.name}”.` }));
  res.json({ ok: true });
}));

r.post('/work/teams/:id/invite-code', h((req, res) => {
  const t = activeTeamOr404(req.params.id);
  mustManage(req, t.id);
  const code = newInviteCode();
  run('UPDATE teams SET invite_code = ? WHERE id = ?', code, t.id);
  res.json({ invite_code: code });
}));

r.post('/work/join', h((req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const t = code && get("SELECT * FROM teams WHERE invite_code = ? AND status = 'active'", code);
  if (!t) fail(404, 'That invite code doesn’t match a team. Check it with the person who shared it.');
  if (memberRole(req.user, t.id)) return res.json(teamOut(t.id, req.user));
  tx(() => {
    addMember(t.id, req.user.id);
    run("UPDATE team_invites SET status = 'accepted', responded_at = ? WHERE team_id = ? AND status = 'pending' AND (user_id = ? OR email = ?)", nowIso(), t.id, req.user.id, req.user.email);
  });
  managerIds(t.id).forEach((uid) => notify({ userId: uid, type: 'team_join', actorId: req.user.id, entityType: 'team', entityId: t.id, title: t.name, body: `${req.user.full_name} joined with the invite code.` }));
  res.json(teamOut(t.id, req.user));
}));

r.post('/work/teams/:id/leave', h((req, res) => {
  const t = activeTeamOr404(req.params.id);
  const role = memberRole(req.user, t.id);
  if (!role) fail(400, 'You are not on this team.');
  if (role === 'owner') fail(400, 'Owners can’t leave. Make someone else the owner first, or delete the team.');
  removeMember(t.id, req.user.id);
  res.json({ ok: true });
}));

// ---------- members ----------
r.get('/work/members', h((req, res) => {
  const t = team(req);
  const manage = canManageTeam(req.user, t);
  const today = localDay();
  const s = teamSettings(t);
  const rows = all("SELECT m.user_id, m.role, m.joined_at FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? AND u.status = 'active'", t);
  res.json(rows.map((m) => {
    const u = publicUser(m.user_id);
    return {
      ...u,
      team_role: m.role,
      joined_at: m.joined_at,
      canPost: m.role !== 'member' || !!s.members_can_post,
      ...(manage ? {
        last_active_at: get('SELECT last_active_at FROM users WHERE id = ?', m.user_id).last_active_at,
        mood_today: get('SELECT mood FROM mood_logs WHERE user_id = ? AND day = ? ORDER BY id DESC LIMIT 1', m.user_id, today)?.mood || null,
        active_days_7: get('SELECT COUNT(*) c FROM activity_days WHERE user_id = ? AND day > ?', m.user_id, addDays(today, -7)).c,
      } : {}),
    };
  }).sort((a, b) => ROLE_ORDER.indexOf(a.team_role) - ROLE_ORDER.indexOf(b.team_role) || a.full_name.localeCompare(b.full_name)));
}));

// Owner: make someone an admin or a member, or hand over ownership.
r.patch('/work/teams/:id/members/:userId', h((req, res) => {
  const t = activeTeamOr404(req.params.id);
  mustOwn(req, t.id);
  const uid = Number(req.params.userId);
  if (uid === req.user.id) fail(400, 'Pick someone else.');
  if (!memberRole(uid, t.id)) fail(404, 'That person is not on this team.');
  const role = req.body?.role;
  if (!ROLE_ORDER.includes(role)) fail(400, 'Choose owner, admin or member.');
  tx(() => {
    if (role === 'owner') {
      run("UPDATE team_members SET role = 'admin' WHERE team_id = ? AND user_id = ?", t.id, req.user.id);
      run('UPDATE teams SET owner_id = ? WHERE id = ?', uid, t.id);
      syncChannels(t.id, req.user.id, 'admin');
    }
    run('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?', role, t.id, uid);
    syncChannels(t.id, uid, role);
  });
  const what = role === 'owner' ? 'made you the owner of' : role === 'admin' ? 'made you an admin of' : 'changed your role in';
  notify({ userId: uid, type: 'team', actorId: req.user.id, entityType: 'team', entityId: t.id, title: t.name, body: `${req.user.full_name} ${what} ${t.name}.` });
  res.json({ ok: true, role });
}));

r.delete('/work/teams/:id/members/:userId', h((req, res) => {
  const t = activeTeamOr404(req.params.id);
  mustOwn(req, t.id);
  const uid = Number(req.params.userId);
  if (uid === req.user.id) fail(400, 'Owners can’t remove themselves.');
  if (!memberRole(uid, t.id)) fail(404, 'That person is not on this team.');
  removeMember(t.id, uid);
  notify({ userId: uid, type: 'team', actorId: req.user.id, title: t.name, body: `You were removed from ${t.name}.` });
  res.json({ ok: true });
}));

// ---------- invitations ----------
function myInvites(u) {
  return all(
    `SELECT i.* FROM team_invites i JOIN teams t ON t.id = i.team_id
     WHERE i.status = 'pending' AND t.status = 'active' AND (i.user_id = ? OR (i.user_id IS NULL AND i.email = ?)) ORDER BY i.id DESC`,
    u.id, u.email
  ).filter((i) => !memberRole(u, i.team_id));
}
const inviteOut = (i) => {
  const t = teamRow(i.team_id);
  return {
    id: i.id, status: i.status, created_at: i.created_at, email: i.email, user: i.user_id ? publicUser(i.user_id) : null, invited_by: publicUser(i.invited_by),
    team: t && { id: t.id, name: t.name, logo: t.logo, description: t.description, members: teamMemberIds(t.id).length },
  };
};

r.get('/work/invites', h((req, res) => res.json(myInvites(req.user).map(inviteOut))));

// Invite friends (userIds), or anyone by username or email (identifiers). Emails without an account get an email invitation.
r.post('/work/teams/:id/invites', h(async (req, res) => {
  const t = activeTeamOr404(req.params.id);
  if (!canInvite(req.user, t.id)) fail(403, 'Only team owners and admins can invite people.');
  const ids = [].concat(req.body?.userIds || []).map(Number).filter(Boolean).slice(0, 50);
  const idents = [].concat(req.body?.identifiers || []).map((x) => String(x).trim().replace(/^@/, '')).filter(Boolean).slice(0, 20);
  if (!ids.length && !idents.length) fail(400, 'Choose friends, or enter a username or email.');
  const results = [];
  const pending = (uid, email) => get("SELECT id FROM team_invites WHERE team_id = ? AND status = 'pending' AND (user_id = ? OR (? IS NOT NULL AND email = ?))", t.id, uid, email, email);
  const inviteUser = (u, label) => {
    if (!u || u.status !== 'active') return results.push({ target: label, ok: false, reason: 'No Hunch account found' });
    if (memberRole(u.id, t.id)) return results.push({ target: label, ok: false, reason: 'Already on the team' });
    if (pending(u.id, null)) return results.push({ target: label, ok: false, reason: 'Already invited' });
    const id = Number(run('INSERT INTO team_invites (team_id, user_id, invited_by) VALUES (?, ?, ?)', t.id, u.id, req.user.id).lastInsertRowid);
    notify({ userId: u.id, type: 'team_invite', actorId: req.user.id, entityType: 'team_invite', entityId: id, title: 'Team invitation', body: `${req.user.full_name} invited you to join ${t.name}.` });
    return results.push({ target: label, ok: true, user: publicUser(u.id) });
  };
  for (const uid of ids) {
    if (!areFriends(req.user.id, uid)) { results.push({ target: String(uid), ok: false, reason: 'Not your friend' }); continue; }
    inviteUser(get('SELECT * FROM users WHERE id = ?', uid), publicUser(uid)?.full_name || String(uid));
  }
  for (const x of idents) {
    const u = get('SELECT * FROM users WHERE username = ? OR email = ?', x, x);
    if (u || !EMAIL.test(x)) { inviteUser(u, x); continue; }
    const email = x.toLowerCase();
    if (pending(null, email)) { results.push({ target: x, ok: false, reason: 'Already invited' }); continue; }
    run('INSERT INTO team_invites (team_id, email, invited_by) VALUES (?, ?, ?)', t.id, email, req.user.id);
    const emailed = await sendTeamInvite(email, req.user.full_name, t.name).catch(() => false);
    results.push({ target: x, ok: true, reason: emailed ? 'Invitation emailed' : 'They’ll see it after signing up with this email' });
  }
  res.json({ results });
}));

r.get('/work/teams/:id/invites', h((req, res) => {
  const t = activeTeamOr404(req.params.id);
  if (!canInvite(req.user, t.id)) fail(403, 'Only team owners and admins can see invitations.');
  res.json(all("SELECT * FROM team_invites WHERE team_id = ? AND status = 'pending' ORDER BY id DESC", t.id).map(inviteOut));
}));

r.post('/work/invites/:id', h((req, res) => {
  const i = get("SELECT * FROM team_invites WHERE id = ? AND status = 'pending'", Number(req.params.id));
  if (!i) fail(404, 'This invitation is no longer available.');
  const decision = req.body?.decision;
  // The invitee accepts or declines; owners/admins (or whoever sent it) can cancel.
  if (decision === 'cancel') {
    if (!(canManageTeam(req.user, i.team_id) || i.invited_by === req.user.id)) fail(403, 'You can’t cancel this invitation.');
    run("UPDATE team_invites SET status = 'cancelled', responded_at = ? WHERE id = ?", nowIso(), i.id);
    return res.json({ ok: true });
  }
  const mine = i.user_id ? i.user_id === req.user.id : String(i.email).toLowerCase() === String(req.user.email).toLowerCase();
  if (!mine) fail(403, 'This invitation is for someone else.');
  if (!['accept', 'decline'].includes(decision)) fail(400, 'Choose accept or decline.');
  const t = activeTeamOr404(i.team_id);
  tx(() => {
    run('UPDATE team_invites SET status = ?, user_id = ?, responded_at = ? WHERE id = ?', decision === 'accept' ? 'accepted' : 'declined', req.user.id, nowIso(), i.id);
    if (decision === 'accept') addMember(t.id, req.user.id);
  });
  if (decision === 'accept') {
    managerIds(t.id).filter((id) => id !== req.user.id).forEach((uid) => notify({ userId: uid, type: 'team_join', actorId: req.user.id, entityType: 'team', entityId: t.id, title: t.name, body: `${req.user.full_name} accepted the invitation and joined.` }));
  }
  res.json({ ok: true, team: decision === 'accept' ? teamOut(t.id, req.user) : null });
}));

// ---------- channels ----------
r.get('/work/teams/:id/channels', h((req, res) => {
  const t = activeTeamOr404(req.params.id);
  if (!canAccessTeam(req.user, t.id)) fail(403, 'You are not on this team.');
  res.json(all('SELECT id, name, description, created_at FROM conversations WHERE team_id = ? ORDER BY id', t.id));
}));
r.post('/work/teams/:id/channels', h((req, res) => {
  const t = activeTeamOr404(req.params.id);
  mustManage(req, t.id);
  const name = String(req.body?.name || '').trim().replace(/^#/, '').slice(0, 40);
  if (!name) fail(400, 'Name the channel.');
  if (channelIds(t.id).length >= 30) fail(400, 'A team can have up to 30 channels.');
  const cid = tx(() => createChannel(t.id, name, req.user.id));
  run('UPDATE conversations SET description = ? WHERE id = ?', String(req.body?.description || '').trim().slice(0, 300), cid);
  emitToUsers(teamMemberIds(t.id), 'conversation:update', { id: cid });
  res.status(201).json(get('SELECT id, name, description, created_at FROM conversations WHERE id = ?', cid));
}));
r.delete('/work/channels/:id', h((req, res) => {
  const c = get('SELECT * FROM conversations WHERE id = ? AND team_id IS NOT NULL', Number(req.params.id));
  if (!c) fail(404, 'Channel not found.');
  mustManage(req, c.team_id);
  if (channelIds(c.team_id).length <= 1) fail(400, 'A team keeps at least one channel.');
  const members = teamMemberIds(c.team_id);
  run('DELETE FROM conversations WHERE id = ?', c.id);
  emitToUsers(members, 'conversation:update', { id: c.id });
  res.json({ ok: true });
}));

// ---------- team stories (Work visibility) ----------
// Team-only stories also appear at the top of the team's Work feed.
r.get('/work/stories', h((req, res) => {
  const t = team(req);
  const rows = all("SELECT * FROM stories WHERE audience = 'team' AND team_id = ? AND expires_at > ? ORDER BY id", t, nowIso());
  const byUser = new Map();
  for (const s of rows) {
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, { user: publicUser(s.user_id), stories: [] });
    byUser.get(s.user_id).stories.push(storyOut(s, req.user.id));
  }
  res.json([...byUser.values()].map((g) => ({ ...g, allSeen: g.stories.every((s) => s.seen) })));
}));

// ---------- feed ----------
r.get('/work/feed', h((req, res) => {
  const t = team(req);
  const before = Number(req.query.before) || 1e15;
  const kind = ['announcement', 'post'].includes(req.query.kind) ? req.query.kind : null;
  const pinned = before === 1e15 && !kind ? hydratePosts(all('SELECT * FROM posts WHERE team_id = ? AND pinned = 1 ORDER BY id DESC', t), req.user.id) : [];
  const rows = all(`SELECT * FROM posts WHERE team_id = ? AND id < ? ${kind ? 'AND kind = ?' : 'AND pinned = 0'} ORDER BY id DESC LIMIT 15`, t, before, ...(kind ? [kind] : []));
  res.json({ pinned, posts: hydratePosts(rows, req.user.id), nextBefore: rows.length === 15 ? rows[rows.length - 1].id : null });
}));

r.post('/work/posts', imageUpload.array('images', 10), h((req, res) => {
  const t = team(req, req.body);
  if (!canPostInTeam(req.user, t)) fail(403, 'Only team owners and admins can post in this team’s Work feed.');
  const text = String(req.body?.text || '').trim().slice(0, 5000);
  const files = req.files || [];
  if (!text && !files.length) fail(400, 'Write something or add a photo.');
  const kind = req.body?.kind === 'announcement' && canManageTeam(req.user, t) ? 'announcement' : 'post';
  const pinned = ['1', 'true'].includes(req.body?.pinned) && canManageTeam(req.user, t) ? 1 : 0;
  const id = tx(() => {
    const id = Number(run('INSERT INTO posts (user_id, text, team_id, kind, pinned) VALUES (?, ?, ?, ?, ?)', req.user.id, text, t, kind, pinned).lastInsertRowid);
    files.forEach((f, i) => run('INSERT INTO post_images (post_id, url, position) VALUES (?, ?, ?)', id, fileUrl(f), i));
    return id;
  });
  const tn = teamRow(t).name;
  fanout(t, req.user.id, kind === 'announcement'
    ? { type: 'work_announcement', actorId: req.user.id, entityType: 'post', entityId: id, title: `📣 ${tn} announcement`, body: `${req.user.full_name}: ${text.slice(0, 100) || 'New photo'}` }
    : { type: 'work_post', actorId: req.user.id, entityType: 'post', entityId: id, title: `${tn} · Work feed`, body: `${req.user.full_name} posted: ${text.slice(0, 100) || 'a photo'}` });
  res.status(201).json(hydratePost(get('SELECT * FROM posts WHERE id = ?', id), req.user.id));
}));

r.post('/work/posts/:id/pin', h((req, res) => {
  const p = get('SELECT * FROM posts WHERE id = ? AND team_id IS NOT NULL', Number(req.params.id));
  if (!p) fail(404, 'Work post not found.');
  mustManage(req, p.team_id);
  run('UPDATE posts SET pinned = ? WHERE id = ?', p.pinned ? 0 : 1, p.id);
  res.json({ pinned: !p.pinned });
}));

// ---------- schedules ----------
const schedOut = (s) => ({ ...s, user: s.user_id ? publicUser(s.user_id) : null, label: KIND_LABEL[s.kind] });
r.get('/work/schedules', h((req, res) => {
  const t = team(req);
  const from = DAY.test(req.query.from || '') ? req.query.from : addDays(localDay(), -7);
  const to = DAY.test(req.query.to || '') ? req.query.to : addDays(from, 41);
  // Members see team-wide items plus their own; leaders see everyone's (optionally filtered to one person).
  const manage = canManageTeam(req.user, t);
  const who = manage ? Number(req.query.user) || null : req.user.id;
  const rows = who
    ? all('SELECT * FROM schedules WHERE team_id = ? AND day BETWEEN ? AND ? AND (user_id IS NULL OR user_id = ?) ORDER BY day, start_time', t, from, to, who)
    : all('SELECT * FROM schedules WHERE team_id = ? AND day BETWEEN ? AND ? ORDER BY day, start_time', t, from, to);
  res.json(rows.map(schedOut));
}));
function readSchedule(b, t) {
  const kind = SCHEDULE_KINDS.includes(b.kind) ? b.kind : fail(400, 'Choose a schedule type.');
  const start = b.start_time ? (TIME.test(b.start_time) ? b.start_time : fail(400, 'Start time must look like 08:00.')) : null;
  const end = b.end_time ? (TIME.test(b.end_time) ? b.end_time : fail(400, 'End time must look like 17:00.')) : null;
  if (kind !== 'rest' && (!start || !end)) fail(400, 'Set a start and end time.');
  const userId = b.user_id ? Number(b.user_id) : null;
  if (userId && !teamMemberIds(t).includes(userId)) fail(400, 'That person is not on this team.');
  return { kind, start: kind === 'rest' ? null : start, end: kind === 'rest' ? null : end, userId, title: String(b.title || '').trim().slice(0, 80), notes: String(b.notes || '').trim().slice(0, 500) };
}
r.post('/work/schedules', h((req, res) => {
  const t = team(req, req.body);
  mustManage(req, t);
  const v = readSchedule(req.body || {}, t);
  const days = [...new Set([].concat(req.body?.days || req.body?.day || []))].filter((d) => DAY.test(d)).slice(0, 62);
  if (!days.length) fail(400, 'Pick at least one date.');
  const userIds = [].concat(req.body?.user_ids || []).map(Number).filter((id) => teamMemberIds(t).includes(id));
  const targets = userIds.length ? userIds : [v.userId];
  const ids = tx(() => days.flatMap((day) => targets.map((uid) => Number(run(
    'INSERT INTO schedules (team_id, user_id, kind, title, day, start_time, end_time, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    t, uid, v.kind, v.title, day, v.start, v.end, v.notes, req.user.id
  ).lastInsertRowid))));
  const when = days.length === 1 ? new Date(`${days[0]}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : `${days.length} days`;
  const body = `${req.user.full_name} added ${KIND_LABEL[v.kind].toLowerCase()}${v.title ? ` “${v.title}”` : ''} · ${when}${v.start ? ` · ${v.start}–${v.end}` : ''}`;
  const recipients = targets.includes(null) ? teamMemberIds(t) : targets;
  recipients.filter((id) => id !== req.user.id).forEach((uid) => notify({ userId: uid, type: 'schedule', actorId: req.user.id, entityType: 'schedule', entityId: ids[0], title: 'Schedule update', body }));
  res.status(201).json(ids.map((id) => schedOut(get('SELECT * FROM schedules WHERE id = ?', id))));
}));
r.patch('/work/schedules/:id', h((req, res) => {
  const s = get('SELECT * FROM schedules WHERE id = ?', Number(req.params.id));
  if (!s) fail(404, 'Schedule not found.');
  mustManage(req, s.team_id);
  const v = readSchedule({ ...s, ...req.body }, s.team_id);
  const day = DAY.test(req.body?.day || '') ? req.body.day : s.day;
  run('UPDATE schedules SET kind = ?, title = ?, day = ?, start_time = ?, end_time = ?, notes = ?, user_id = ? WHERE id = ?', v.kind, v.title, day, v.start, v.end, v.notes, v.userId, s.id);
  res.json(schedOut(get('SELECT * FROM schedules WHERE id = ?', s.id)));
}));
r.delete('/work/schedules/:id', h((req, res) => {
  const s = get('SELECT * FROM schedules WHERE id = ?', Number(req.params.id));
  if (!s) fail(404, 'Schedule not found.');
  mustManage(req, s.team_id);
  run('DELETE FROM schedules WHERE id = ?', s.id);
  res.json({ ok: true });
}));

// ---------- team mood analytics ----------
const groupOf = (m) => (POSITIVE.includes(m) ? 'positive' : LOW_ENERGY.includes(m) ? 'low' : NEGATIVE.includes(m) ? 'negative' : 'positive');
export function teamMood(t) {
  const ids = teamMemberIds(t);
  const ph = ids.map(() => '?').join(',') || 'NULL';
  const today = localDay();
  const from = addDays(today, -6);
  const logs = all(`SELECT user_id, mood, day, id FROM mood_logs WHERE user_id IN (${ph}) AND day BETWEEN ? AND ? ORDER BY id`, ...ids, addDays(today, -13), today);
  // Latest mood per person per day.
  const daily = new Map();
  logs.forEach((l) => daily.set(`${l.user_id}|${l.day}`, l));
  const perDay = (d) => [...daily.values()].filter((l) => l.day === d);
  const todays = perDay(today);
  const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
  const dist = (rows) => MOODS.map((m) => ({ mood: m.key, label: m.label, emoji: m.emoji, count: rows.filter((r) => r.mood === m.key).length }))
    .filter((x) => x.count).sort((a, b) => b.count - a.count).map((x) => ({ ...x, pct: pct(x.count, rows.length) }));
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const trend = days.map((d) => {
    const rows = perDay(d);
    const g = (k) => rows.filter((r) => groupOf(r.mood) === k).length;
    return { day: d, participants: rows.length, positive: pct(g('positive'), rows.length), low: pct(g('low'), rows.length), negative: pct(g('negative'), rows.length) };
  });
  const week = [...daily.values()].filter((l) => l.day >= from);
  const prev = [...daily.values()].filter((l) => l.day < from);
  const posShare = (rows) => (rows.length ? rows.filter((r) => groupOf(r.mood) === 'positive').length / rows.length : null);
  const a = posShare(week), b = posShare(prev);
  // Burnout indicators: mostly tired/sleepy/lazy/sad/angry this week, or 3+ such days in a row.
  const burnout = ids.map((id) => {
    const mine = days.map((d) => daily.get(`${id}|${d}`)).filter(Boolean);
    if (mine.length < 3) return null;
    const heavy = mine.filter((l) => groupOf(l.mood) !== 'positive');
    let streak = 0, best = 0;
    days.forEach((d) => { const l = daily.get(`${id}|${d}`); streak = l && groupOf(l.mood) !== 'positive' ? streak + 1 : 0; best = Math.max(best, streak); });
    const share = heavy.length / mine.length;
    if (share < 0.6 && best < 3) return null;
    const top = dist(heavy)[0];
    return { user: publicUser(id), share: Math.round(share * 100), streak: best, top: top && { ...moodByKey(top.mood), key: top.mood },
      reason: best >= 3 ? `${best} low or negative days in a row` : `${Math.round(share * 100)}% low or negative check-ins this week` };
  }).filter(Boolean).sort((x, y) => y.share - x.share);
  const active7 = new Set(week.map((l) => l.user_id)).size;
  return {
    team: { id: t, name: teamRow(t)?.name }, members: ids.length,
    today: { participants: todays.length, participation: pct(todays.length, ids.length), distribution: dist(todays) },
    week: { distribution: dist(week), top: dist(week)[0] || null, participation: pct(active7, ids.length),
      avgDailyParticipation: Math.round(trend.reduce((s, d) => s + pct(d.participants, ids.length), 0) / 7) },
    trend,
    direction: a === null || b === null ? 'steady' : a - b > 0.05 ? 'improving' : b - a > 0.05 ? 'declining' : 'steady',
    burnout,
  };
}
r.get('/work/mood', h((req, res) => {
  const t = team(req);
  if (!canManageTeam(req.user, t)) fail(403, 'Team mood analytics are for team owners and admins.');
  res.json(teamMood(t));
}));

export default r;
