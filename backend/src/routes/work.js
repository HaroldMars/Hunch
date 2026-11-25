import { Router } from 'express';
import { MOODS, moodByKey, TEAM_ROLES, TEAM_ROLE_LABELS } from '../../../shared/constants.js';
import { get, all, run, tx, newInviteCode, ensureTeamChannels, channelRoleFor } from '../db.js';
import { auth } from '../auth.js';
import { h, fail, imageUpload, fileUrl, publicUser, selfUser, nowIso, localDay, addDays, deleteStoredFiles, areFriends } from '../util.js';
import { notify } from '../notify.js';
import { sendTeamInvite } from '../mailer.js';
import { emitToUsers } from '../realtime.js';
import { hydratePosts, hydratePost } from './posts.js';
import { storyOut } from './stories.js';
import { POSITIVE, LOW_ENERGY, NEGATIVE } from '../analytics.js';
import { postMessage } from './chats.js';
import {
  workTeams, memberRole, canAccessTeam, canManageTeam, isTeamOwner, canInvite, canPostInTeam, teamSettings, teamMemberIds, resolveTeam, teamRow,
  canAssignRoles, canEditSettings, canSeeAnalytics, canSchedule, canMonitor, canAnnounce, ROLE_RANK,
} from '../teams.js';

const r = Router();
r.use(auth());

export const SCHEDULE_KINDS = ['shift', 'rest', 'lunch', 'meeting', 'overtime', 'coaching', 'training'];
const KIND_LABEL = { shift: 'Shift', rest: 'Rest day', lunch: 'Lunch', meeting: 'Meeting', overtime: 'Overtime', coaching: 'Coaching session', training: 'Training' };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const readRole = (v, fallback) => (v === 'member' ? 'agent' : TEAM_ROLES.includes(v) ? v : fallback);
const roleLabel = (r) => TEAM_ROLE_LABELS[r] || r;
const anRole = (r) => (r === 'sme' ? 'an SME' : r === 'agent' ? 'an Agent' : `a ${roleLabel(r)}`);

/** The team this request is about; the user must be a member. */
function team(req, source = req.query) {
  const t = resolveTeam(req.user, source?.team);
  if (!t) fail(404, source?.team ? 'You are not a member of that team.' : 'You are not on a team yet. Create one or accept an invitation.');
  return t;
}
const mustManage = (req, t) => { if (!canManageTeam(req.user, t)) fail(403, 'Only managers and team leaders can do that.'); };
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
    my_role: memberRole(me, row.id), is_owner: row.owner_id === me?.id, created_at: row.created_at,
    invite_code: canInvite(me, row.id) ? row.invite_code : undefined,
  };
}
const fanout = (teamId, exceptId, payload) => teamMemberIds(teamId).filter((id) => id !== exceptId).forEach((uid) => notify({ ...payload, userId: uid }));
const managerIds = (teamId) => all("SELECT m.user_id FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.team_id = ? AND (m.role IN ('manager','tl') OR m.user_id = t.owner_id)", teamId).map((m) => m.user_id);

// ---------- team channels (group chats that belong to a team) ----------
// Every member is in every channel; managers, team leaders and the owner are channel admins.
const channelIds = (teamId) => all('SELECT id FROM conversations WHERE team_id = ?', teamId).map((c) => c.id);
function syncChannels(teamId, userId, teamRoleOrNull) {
  const owner = teamRow(teamId)?.owner_id === userId;
  for (const cid of channelIds(teamId)) {
    if (!teamRoleOrNull) run('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', cid, userId);
    else run(`INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)
             ON CONFLICT(conversation_id, user_id) DO UPDATE SET role = excluded.role`, cid, userId, channelRoleFor(teamRoleOrNull, owner));
    emitToUsers([userId], 'conversation:update', { id: cid });
  }
}
function createChannel(teamId, name, by) {
  const owner = teamRow(teamId)?.owner_id;
  const cid = Number(run("INSERT INTO conversations (type, name, created_by, team_id) VALUES ('group', ?, ?, ?)", name, by, teamId).lastInsertRowid);
  all('SELECT user_id, role FROM team_members WHERE team_id = ?', teamId)
    .forEach((m) => run('INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)', cid, m.user_id, channelRoleFor(m.role, m.user_id === owner)));
  return cid;
}
/** Post an automatic update into one of the team's standard channels (schedules, announcements, meetings, projects). */
function channelUpdate(teamId, key, actor, text) {
  const c = get('SELECT id FROM conversations WHERE team_id = ? AND team_channel = ?', teamId, key);
  if (!c) return;
  try { postMessage({ conversationId: c.id, sender: actor, text, kind: 'system' }); } catch { /* a channel post never blocks the action itself */ }
}
const dayLabel = (d) => new Date(`${d}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const clock = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
function addMember(teamId, userId, role = 'agent') {
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
    isOwner: isTeamOwner(req.user, t),
    canManage: canManageTeam(req.user, t),
    canAssign: canAssignRoles(req.user, t),
    canEditSettings: canEditSettings(req.user, t),
    canSchedule: canSchedule(req.user, t),
    canMonitor: canMonitor(req.user, t),
    canAnnounce: canAnnounce(req.user, t),
    canAnalytics: canSeeAnalytics(req.user, t),
    canPost: canPostInTeam(req.user, t),
    canInvite: canInvite(req.user, t),
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
  const owned = get("SELECT COUNT(*) c FROM teams WHERE owner_id = ? AND status = 'active'", req.user.id).c;
  if (owned >= 20) fail(400, 'You can own up to 20 teams.');
  // The creator picks their own role: Manager, Team Leader, SME or Member (Agent).
  const myRole = readRole(b.my_role, 'manager');
  const id = tx(() => {
    const id = Number(run('INSERT INTO teams (name, description, logo, owner_id, created_by, invite_code, members_can_invite, department) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      name, description, fileUrl(req.file), req.user.id, req.user.id, newInviteCode(), flag(b.members_can_invite) ?? 0, '').lastInsertRowid);
    run('INSERT INTO team_settings (team_id, members_can_post) VALUES (?, ?)', id, flag(b.members_can_post) ?? 0);
    run('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)', id, req.user.id, myRole);
    ensureTeamChannels(id);
    run('UPDATE users SET work_mode = 1 WHERE id = ?', req.user.id);
    return id;
  });
  res.status(201).json(teamOut(id, req.user));
}));

// Owner: name, description, logo. Managers (and the owner): team settings.
r.patch('/work/teams/:id', imageUpload.single('logo'), h((req, res) => {
  const t = activeTeamOr404(req.params.id);
  if (!canEditSettings(req.user, t.id)) fail(403, 'Only the owner and managers can change the team.');
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
  if (!memberRole(req.user, t.id)) fail(400, 'You are not on this team.');
  if (t.owner_id === req.user.id) fail(400, 'Owners can’t leave. Make someone else the owner first, or delete the team.');
  removeMember(t.id, req.user.id);
  res.json({ ok: true });
}));

// ---------- members ----------
r.get('/work/members', h((req, res) => {
  const t = team(req);
  const monitor = canMonitor(req.user, t);
  const analytics = canSeeAnalytics(req.user, t);
  const owner = teamRow(t).owner_id;
  const today = localDay();
  const s = teamSettings(t);
  const rows = all("SELECT m.user_id, m.role, m.joined_at FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? AND u.status = 'active'", t);
  res.json(rows.map((m) => {
    const u = publicUser(m.user_id);
    return {
      ...u,
      team_role: m.role,
      is_owner: m.user_id === owner,
      joined_at: m.joined_at,
      canPost: m.role !== 'agent' || m.user_id === owner || !!s.members_can_post,
      // SMEs, team leaders and managers monitor activity; mood check-ins are for managers only.
      ...(monitor ? {
        last_active_at: get('SELECT last_active_at FROM users WHERE id = ?', m.user_id).last_active_at,
        active_days_7: get('SELECT COUNT(*) c FROM activity_days WHERE user_id = ? AND day > ?', m.user_id, addDays(today, -7)).c,
      } : {}),
      ...(analytics ? { mood_today: get('SELECT mood FROM mood_logs WHERE user_id = ? AND day = ? ORDER BY id DESC LIMIT 1', m.user_id, today)?.mood || null } : {}),
    };
  }).sort((a, b) => (b.is_owner - a.is_owner) || ROLE_RANK[b.team_role] - ROLE_RANK[a.team_role] || a.full_name.localeCompare(b.full_name)));
}));

/** Can `actor` act on `target` (change their role or remove them)? The owner can act on anyone; others only on lower roles. */
function outranks(actorId, targetId, teamId) {
  const t = teamRow(teamId);
  if (t.owner_id === actorId) return true;
  if (t.owner_id === targetId) return false;
  return ROLE_RANK[memberRole(actorId, teamId)] > ROLE_RANK[memberRole(targetId, teamId)];
}

// Assign a role (owner and managers), or hand over ownership (owner only, with { owner: true }).
r.patch('/work/teams/:id/members/:userId', h((req, res) => {
  const t = activeTeamOr404(req.params.id);
  const uid = Number(req.params.userId);
  const current = memberRole(uid, t.id);
  if (!current) fail(404, 'That person is not on this team.');
  if (req.body?.owner) {
    mustOwn(req, t.id);
    if (uid === req.user.id) fail(400, 'You already own this team.');
    tx(() => {
      run('UPDATE teams SET owner_id = ? WHERE id = ?', uid, t.id);
      syncChannels(t.id, req.user.id, memberRole(req.user, t.id));
      syncChannels(t.id, uid, current);
    });
    notify({ userId: uid, type: 'team', actorId: req.user.id, entityType: 'team', entityId: t.id, title: t.name, body: `${req.user.full_name} made you the owner of ${t.name}.` });
    return res.json({ ok: true, owner: uid, role: current });
  }
  if (!canAssignRoles(req.user, t.id)) fail(403, 'Only the owner and managers can assign roles.');
  const role = readRole(req.body?.role, null);
  if (!role) fail(400, 'Choose Manager, Team Leader, SME or Agent.');
  const self = uid === req.user.id;
  // The owner can set anyone's role, including their own. Managers assign roles to people below them.
  if (self ? t.owner_id !== req.user.id : !outranks(req.user.id, uid, t.id)) fail(403, self ? 'Ask the owner to change your role.' : 'You can only change the role of people below you.');
  tx(() => {
    run('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?', role, t.id, uid);
    syncChannels(t.id, uid, role);
  });
  if (!self && role !== current) notify({ userId: uid, type: 'team', actorId: req.user.id, entityType: 'team', entityId: t.id, title: t.name, body: `${req.user.full_name} made you ${anRole(role)} in ${t.name}.` });
  res.json({ ok: true, role });
}));

// Remove a member: the owner removes anyone; managers and team leaders remove people below them.
r.delete('/work/teams/:id/members/:userId', h((req, res) => {
  const t = activeTeamOr404(req.params.id);
  mustManage(req, t.id);
  const uid = Number(req.params.userId);
  if (uid === req.user.id) fail(400, 'You can’t remove yourself. Leave the team instead.');
  if (!memberRole(uid, t.id)) fail(404, 'That person is not on this team.');
  if (!outranks(req.user.id, uid, t.id)) fail(403, 'You can only remove people below you.');
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
  if (!canInvite(req.user, t.id)) fail(403, 'Only managers and team leaders can invite people.');
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
  if (!canInvite(req.user, t.id)) fail(403, 'Only managers and team leaders can see invitations.');
  res.json(all("SELECT * FROM team_invites WHERE team_id = ? AND status = 'pending' ORDER BY id DESC", t.id).map(inviteOut));
}));

r.post('/work/invites/:id', h((req, res) => {
  const i = get("SELECT * FROM team_invites WHERE id = ? AND status = 'pending'", Number(req.params.id));
  if (!i) fail(404, 'This invitation is no longer available.');
  const decision = req.body?.decision;
  // The invitee accepts or declines; managers, team leaders (or whoever sent it) can cancel.
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
  res.json(all("SELECT id, name, description, team_channel, created_at FROM conversations WHERE team_id = ? ORDER BY team_channel IS NULL, CASE team_channel WHEN 'general' THEN 1 WHEN 'announcements' THEN 2 WHEN 'schedules' THEN 3 WHEN 'meetings' THEN 4 WHEN 'projects' THEN 5 END, id", t.id));
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
  res.status(201).json(get('SELECT id, name, description, team_channel, created_at FROM conversations WHERE id = ?', cid));
}));
r.delete('/work/channels/:id', h((req, res) => {
  const c = get('SELECT * FROM conversations WHERE id = ? AND team_id IS NOT NULL', Number(req.params.id));
  if (!c) fail(404, 'Channel not found.');
  mustManage(req, c.team_id);
  if (c.team_channel) fail(400, `#${c.name} is one of the team’s standard channels and can’t be deleted.`);
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
  if (!canPostInTeam(req.user, t)) fail(403, 'Agents can’t post in this team’s Work feed. A manager can allow it in team settings.');
  const text = String(req.body?.text || '').trim().slice(0, 5000);
  const files = req.files || [];
  if (!text && !files.length) fail(400, 'Write something or add a photo.');
  if (req.body?.kind === 'announcement' && !canAnnounce(req.user, t)) fail(403, 'Only managers and team leaders post announcements.');
  const kind = req.body?.kind === 'announcement' ? 'announcement' : 'post';
  const pinned = ['1', 'true'].includes(req.body?.pinned) && canManageTeam(req.user, t) ? 1 : 0;
  const id = tx(() => {
    const id = Number(run('INSERT INTO posts (user_id, text, team_id, kind, pinned) VALUES (?, ?, ?, ?, ?)', req.user.id, text, t, kind, pinned).lastInsertRowid);
    files.forEach((f, i) => run('INSERT INTO post_images (post_id, url, position) VALUES (?, ?, ?)', id, fileUrl(f), i));
    return id;
  });
  const tn = teamRow(t).name;
  if (kind === 'announcement') channelUpdate(t, 'announcements', req.user, `📣 ${req.user.full_name}: ${text.slice(0, 300) || 'shared a photo'}`);
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
const mustSchedule = (req, t) => { if (!canSchedule(req.user, t)) fail(403, 'Only managers, team leaders and SMEs manage schedules.'); };
r.get('/work/schedules', h((req, res) => {
  const t = team(req);
  const from = DAY.test(req.query.from || '') ? req.query.from : addDays(localDay(), -7);
  const to = DAY.test(req.query.to || '') ? req.query.to : addDays(from, 41);
  // Agents see team-wide items plus their own; schedulers see everyone's (optionally filtered to one person).
  const manage = canSchedule(req.user, t);
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
  const bs = b.break_start ? (TIME.test(b.break_start) ? b.break_start : fail(400, 'Break start must look like 12:00.')) : null;
  const be = b.break_end ? (TIME.test(b.break_end) ? b.break_end : fail(400, 'Break end must look like 13:00.')) : null;
  if (!!bs !== !!be) fail(400, 'Set both a break start and end, or neither.');
  const userId = b.user_id ? Number(b.user_id) : null;
  if (userId && !teamMemberIds(t).includes(userId)) fail(400, 'That person is not on this team.');
  const rest = kind === 'rest';
  return { kind, start: rest ? null : start, end: rest ? null : end, breakStart: rest ? null : bs, breakEnd: rest ? null : be, userId,
    title: String(b.title || '').trim().slice(0, 80), notes: String(b.notes ?? b.remarks ?? '').trim().slice(0, 500) };
}
const schedLine = (v, who) => `${KIND_LABEL[v.kind]}${v.title ? ` “${v.title}”` : ''}${who ? ` for ${who}` : ''}`;
const timeLine = (v) => (v.start ? ` · ${clock(v.start)} – ${clock(v.end)}${v.breakStart ? ` (break ${clock(v.breakStart)} – ${clock(v.breakEnd)})` : ''}` : '');
const whoLabel = (ids) => (ids.includes(null) ? 'the whole team' : ids.length === 1 ? publicUser(ids[0])?.full_name : `${ids.length} people`);
r.post('/work/schedules', h((req, res) => {
  const t = team(req, req.body);
  mustSchedule(req, t);
  const v = readSchedule(req.body || {}, t);
  const days = [...new Set([].concat(req.body?.days || req.body?.day || []))].filter((d) => DAY.test(d)).slice(0, 62);
  if (!days.length) fail(400, 'Pick at least one date.');
  const userIds = [].concat(req.body?.user_ids || []).map(Number).filter((id) => teamMemberIds(t).includes(id));
  const targets = userIds.length ? userIds : [v.userId];
  const ids = tx(() => days.flatMap((day) => targets.map((uid) => Number(run(
    'INSERT INTO schedules (team_id, user_id, kind, title, day, start_time, end_time, break_start, break_end, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    t, uid, v.kind, v.title, day, v.start, v.end, v.breakStart, v.breakEnd, v.notes, req.user.id
  ).lastInsertRowid))));
  const when = days.length === 1 ? dayLabel(days[0]) : `${days.length} days from ${dayLabel(days[0])}`;
  const line = `${schedLine(v, whoLabel(targets))} · ${when}${timeLine(v)}`;
  const recipients = targets.includes(null) ? teamMemberIds(t) : targets;
  recipients.filter((id) => id !== req.user.id).forEach((uid) => notify({ userId: uid, type: 'schedule', actorId: req.user.id, entityType: 'schedule', entityId: ids[0], title: v.kind === 'meeting' ? 'New meeting' : 'Schedule update', body: `${req.user.full_name} added ${line.charAt(0).toLowerCase()}${line.slice(1)}` }));
  channelUpdate(t, v.kind === 'meeting' ? 'meetings' : 'schedules', req.user, `${v.kind === 'meeting' ? '📅' : '🗓️'} ${req.user.full_name} added ${line.charAt(0).toLowerCase()}${line.slice(1)}${v.notes ? ` · ${v.notes.slice(0, 120)}` : ''}`);
  res.status(201).json(ids.map((id) => schedOut(get('SELECT * FROM schedules WHERE id = ?', id))));
}));

// Weekly schedule: one employee (or several), Monday–Sunday, each day a shift or OFF. Replaces those days' shifts and rest days.
r.post('/work/schedules/week', h((req, res) => {
  const b = req.body || {};
  const t = team(req, b);
  mustSchedule(req, t);
  const members = teamMemberIds(t);
  const userIds = [].concat(b.user_ids || b.user_id || []).map(Number).filter((id) => members.includes(id));
  if (!userIds.length) fail(400, 'Choose the employee this schedule is for.');
  const days = [].concat(b.days || []).filter((d) => d && DAY.test(d.day)).slice(0, 7);
  if (!days.length) fail(400, 'Set at least one day.');
  const remarks = String(b.remarks || '').trim().slice(0, 500);
  const rows = days.map((d) => (d.off ? { day: d.day, ...readSchedule({ kind: 'rest', notes: remarks }, t) } : { day: d.day, ...readSchedule({ kind: 'shift', start_time: d.start_time, end_time: d.end_time, break_start: d.break_start, break_end: d.break_end, notes: remarks }, t) }));
  const ids = tx(() => userIds.flatMap((uid) => rows.map((v) => {
    run("DELETE FROM schedules WHERE team_id = ? AND user_id = ? AND day = ? AND kind IN ('shift','rest')", t, uid, v.day);
    return Number(run('INSERT INTO schedules (team_id, user_id, kind, title, day, start_time, end_time, break_start, break_end, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      t, uid, v.kind, '', v.day, v.start, v.end, v.breakStart, v.breakEnd, v.notes, req.user.id).lastInsertRowid);
  })));
  const sorted = rows.map((v) => v.day).sort();
  const range = `${dayLabel(sorted[0])} – ${dayLabel(sorted[sorted.length - 1])}`;
  const summary = rows.slice().sort((a, b2) => a.day.localeCompare(b2.day))
    .map((v) => `${new Date(`${v.day}T00:00`).toLocaleDateString('en-US', { weekday: 'short' })} ${v.kind === 'rest' ? 'OFF' : `${clock(v.start)}–${clock(v.end)}`}`).join(' · ');
  userIds.filter((id) => id !== req.user.id).forEach((uid) => notify({ userId: uid, type: 'schedule', actorId: req.user.id, entityType: 'schedule', entityId: ids[0], title: 'Your weekly schedule', body: `${req.user.full_name} set your schedule for ${range}.` }));
  channelUpdate(t, 'schedules', req.user, `🗓️ ${req.user.full_name} set the weekly schedule for ${whoLabel(userIds)} (${range}): ${summary}`);
  res.status(201).json(ids.map((id) => schedOut(get('SELECT * FROM schedules WHERE id = ?', id))));
}));
r.patch('/work/schedules/:id', h((req, res) => {
  const s = get('SELECT * FROM schedules WHERE id = ?', Number(req.params.id));
  if (!s) fail(404, 'Schedule not found.');
  mustSchedule(req, s.team_id);
  const v = readSchedule({ ...s, ...req.body }, s.team_id);
  const day = DAY.test(req.body?.day || '') ? req.body.day : s.day;
  run('UPDATE schedules SET kind = ?, title = ?, day = ?, start_time = ?, end_time = ?, break_start = ?, break_end = ?, notes = ?, user_id = ? WHERE id = ?',
    v.kind, v.title, day, v.start, v.end, v.breakStart, v.breakEnd, v.notes, v.userId, s.id);
  if (v.userId && v.userId !== req.user.id) notify({ userId: v.userId, type: 'schedule', actorId: req.user.id, entityType: 'schedule', entityId: s.id, title: 'Schedule changed', body: `${req.user.full_name} changed your ${KIND_LABEL[v.kind].toLowerCase()} on ${dayLabel(day)}${timeLine(v)}` });
  channelUpdate(s.team_id, v.kind === 'meeting' ? 'meetings' : 'schedules', req.user, `✏️ ${req.user.full_name} changed ${schedLine(v, whoLabel([v.userId])).toLowerCase()} · ${dayLabel(day)}${timeLine(v)}`);
  res.json(schedOut(get('SELECT * FROM schedules WHERE id = ?', s.id)));
}));
r.delete('/work/schedules/:id', h((req, res) => {
  const s = get('SELECT * FROM schedules WHERE id = ?', Number(req.params.id));
  if (!s) fail(404, 'Schedule not found.');
  mustSchedule(req, s.team_id);
  run('DELETE FROM schedules WHERE id = ?', s.id);
  if (s.day >= localDay()) channelUpdate(s.team_id, s.kind === 'meeting' ? 'meetings' : 'schedules', req.user, `🗑️ ${req.user.full_name} removed ${schedLine({ kind: s.kind, title: s.title }, whoLabel([s.user_id])).toLowerCase()} · ${dayLabel(s.day)}`);
  res.json({ ok: true });
}));

// ---------- overview: my schedule, upcoming shift and meeting, latest announcements ----------
r.get('/work/overview', h((req, res) => {
  const t = team(req);
  const today = localDay();
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const mine = (kinds) => all(
    `SELECT * FROM schedules WHERE team_id = ? AND (user_id = ? OR user_id IS NULL) AND kind IN (${kinds.map(() => '?').join(',')})
     AND (day > ? OR (day = ? AND (end_time IS NULL OR end_time > ?))) ORDER BY day, start_time LIMIT 1`,
    t, req.user.id, ...kinds, today, today, hhmm
  )[0];
  const shift = mine(['shift', 'overtime']);
  const meeting = mine(['meeting', 'coaching', 'training']);
  const todayItems = all('SELECT * FROM schedules WHERE team_id = ? AND (user_id = ? OR user_id IS NULL) AND day = ? ORDER BY start_time', t, req.user.id, today);
  const announcements = hydratePosts(all("SELECT * FROM posts WHERE team_id = ? AND kind = 'announcement' ORDER BY id DESC LIMIT 3", t), req.user.id);
  const projects = all("SELECT * FROM team_projects WHERE team_id = ? AND status IN ('planning','active') ORDER BY due_date IS NULL, due_date, id DESC LIMIT 3", t).map(projectOut);
  res.json({
    upcomingShift: shift ? schedOut(shift) : null,
    upcomingMeeting: meeting ? schedOut(meeting) : null,
    today: todayItems.map(schedOut),
    announcements,
    projects,
  });
}));

// ---------- projects ----------
const PROJECT_STATUS = ['planning', 'active', 'on_hold', 'done'];
const STATUS_LABEL = { planning: 'Planning', active: 'In progress', on_hold: 'On hold', done: 'Done' };
function projectOut(p) {
  return { ...p, status_label: STATUS_LABEL[p.status], lead: p.lead_id ? publicUser(p.lead_id) : null, created_by: p.created_by ? publicUser(p.created_by) : null };
}
function readProject(b, t, partial = false) {
  const out = {};
  if (!partial || b.name !== undefined) { out.name = String(b.name || '').trim().slice(0, 80); if (!out.name) fail(400, 'Name the project.'); }
  if (!partial || b.description !== undefined) out.description = String(b.description || '').trim().slice(0, 1000);
  if (!partial || b.status !== undefined) out.status = PROJECT_STATUS.includes(b.status) ? b.status : partial ? fail(400, 'Unknown status.') : 'active';
  if (!partial || b.due_date !== undefined) out.due_date = b.due_date ? (DAY.test(b.due_date) ? b.due_date : fail(400, 'Due date must be a date.')) : null;
  if (!partial || b.lead_id !== undefined) {
    out.lead_id = b.lead_id ? Number(b.lead_id) : null;
    if (out.lead_id && !teamMemberIds(t).includes(out.lead_id)) fail(400, 'The project lead must be on the team.');
  }
  return out;
}
r.get('/work/projects', h((req, res) => {
  const t = team(req);
  res.json(all("SELECT * FROM team_projects WHERE team_id = ? ORDER BY status = 'done', due_date IS NULL, due_date, id DESC", t).map(projectOut));
}));
r.post('/work/projects', h((req, res) => {
  const t = team(req, req.body);
  mustManage(req, t);
  if (get('SELECT COUNT(*) c FROM team_projects WHERE team_id = ?', t).c >= 200) fail(400, 'A team can track up to 200 projects.');
  const p = readProject(req.body || {}, t);
  const id = Number(run('INSERT INTO team_projects (team_id, name, description, status, due_date, lead_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    t, p.name, p.description, p.status, p.due_date, p.lead_id, req.user.id).lastInsertRowid);
  channelUpdate(t, 'projects', req.user, `🚀 ${req.user.full_name} started the project “${p.name}”${p.due_date ? ` · due ${dayLabel(p.due_date)}` : ''}${p.lead_id ? ` · lead: ${publicUser(p.lead_id)?.full_name}` : ''}`);
  if (p.lead_id && p.lead_id !== req.user.id) notify({ userId: p.lead_id, type: 'team', actorId: req.user.id, entityType: 'team', entityId: t, title: teamRow(t).name, body: `${req.user.full_name} made you the lead of “${p.name}”.` });
  res.status(201).json(projectOut(get('SELECT * FROM team_projects WHERE id = ?', id)));
}));
r.patch('/work/projects/:id', h((req, res) => {
  const p = get('SELECT * FROM team_projects WHERE id = ?', Number(req.params.id));
  if (!p || !canAccessTeam(req.user, p.team_id)) fail(404, 'Project not found.');
  // Managers and team leaders edit any project; a project's lead can update its status.
  const onlyStatus = Object.keys(req.body || {}).every((k) => k === 'status');
  if (!canManageTeam(req.user, p.team_id) && !(onlyStatus && p.lead_id === req.user.id)) fail(403, 'Only managers, team leaders and the project lead can update projects.');
  const f = readProject(req.body || {}, p.team_id, true);
  const keys = Object.keys(f);
  if (keys.length) run(`UPDATE team_projects SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => f[k]), nowIso(), p.id);
  if (f.status && f.status !== p.status) channelUpdate(p.team_id, 'projects', req.user, `📌 ${req.user.full_name} moved “${f.name || p.name}” to ${STATUS_LABEL[f.status]}`);
  res.json(projectOut(get('SELECT * FROM team_projects WHERE id = ?', p.id)));
}));
r.delete('/work/projects/:id', h((req, res) => {
  const p = get('SELECT * FROM team_projects WHERE id = ?', Number(req.params.id));
  if (!p || !canAccessTeam(req.user, p.team_id)) fail(404, 'Project not found.');
  mustManage(req, p.team_id);
  run('DELETE FROM team_projects WHERE id = ?', p.id);
  res.json({ ok: true });
}));

// ---------- team analytics (managers and the owner) ----------
r.get('/work/analytics', h((req, res) => {
  const t = team(req);
  if (!canSeeAnalytics(req.user, t)) fail(403, 'Team analytics are for managers and the team owner.');
  const ids = teamMemberIds(t);
  const ph = ids.map(() => '?').join(',') || 'NULL';
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const today = localDay();
  const ws = addDays(today, -((new Date(`${today}T00:00`).getDay() + 6) % 7));
  const channels = channelIds(t);
  const cph = channels.map(() => '?').join(',') || 'NULL';
  const postsBy = new Map(all('SELECT user_id, COUNT(*) c FROM posts WHERE team_id = ? AND created_at >= ? GROUP BY user_id', t, since).map((r2) => [r2.user_id, r2.c]));
  const msgsBy = new Map(all(`SELECT sender_id, COUNT(*) c FROM messages WHERE conversation_id IN (${cph}) AND kind != 'system' AND created_at >= ? GROUP BY sender_id`, ...channels, since).map((r2) => [r2.sender_id, r2.c]));
  const roles = all('SELECT role, COUNT(*) c FROM team_members WHERE team_id = ? GROUP BY role', t);
  const activeChannels = all(`SELECT c.id, c.name, COUNT(m.id) messages FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id AND m.kind != 'system' AND m.created_at >= ?
    WHERE c.team_id = ? GROUP BY c.id ORDER BY messages DESC, c.id LIMIT 5`, since, t);
  res.json({
    members: ids.length,
    roles: TEAM_ROLES.map((r2) => ({ role: r2, label: roleLabel(r2), count: roles.find((x) => x.role === r2)?.c || 0 })),
    week: {
      posts: [...postsBy.values()].reduce((a, b2) => a + b2, 0),
      announcements: get("SELECT COUNT(*) c FROM posts WHERE team_id = ? AND kind = 'announcement' AND created_at >= ?", t, since).c,
      messages: [...msgsBy.values()].reduce((a, b2) => a + b2, 0),
      activeMembers: get(`SELECT COUNT(DISTINCT user_id) c FROM activity_days WHERE user_id IN (${ph}) AND day > ?`, ...ids, addDays(today, -7)).c,
      shifts: get("SELECT COUNT(*) c FROM schedules WHERE team_id = ? AND kind IN ('shift','overtime') AND day BETWEEN ? AND ?", t, ws, addDays(ws, 6)).c,
      meetings: get("SELECT COUNT(*) c FROM schedules WHERE team_id = ? AND kind = 'meeting' AND day BETWEEN ? AND ?", t, ws, addDays(ws, 6)).c,
      scheduled: get('SELECT COUNT(DISTINCT user_id) c FROM schedules WHERE team_id = ? AND user_id IS NOT NULL AND day BETWEEN ? AND ?', t, ws, addDays(ws, 6)).c,
    },
    projects: Object.fromEntries(PROJECT_STATUS.map((s) => [s, get('SELECT COUNT(*) c FROM team_projects WHERE team_id = ? AND status = ?', t, s).c])),
    mostActive: ids.map((id) => ({ user: publicUser(id), role: memberRole(id, t), posts: postsBy.get(id) || 0, messages: msgsBy.get(id) || 0 }))
      .map((x) => ({ ...x, score: x.posts * 3 + x.messages })).filter((x) => x.score).sort((a, b2) => b2.score - a.score).slice(0, 5),
    activeChannels,
    mood: teamMood(t),
  });
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
  if (!canSeeAnalytics(req.user, t)) fail(403, 'Team mood analytics are for managers and the team owner.');
  res.json(teamMood(t));
}));

export default r;
