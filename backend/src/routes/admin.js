import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { MOOD_KEYS, ROLE_LABELS, STAFF_ROLES, isStaffRole, TEAM_ROLES, TEAM_ROLE_LABELS, moodByKey } from '../../../shared/constants.js';
import { isOnline } from '../realtime.js';
import { get, all, run, tx, getSetting, setSetting, DEFAULT_SETTINGS, codeFor } from '../db.js';
import { auth, requireModule, creatableRoles, manageableRoles, assignableRoles, teamScope, modulesFor } from '../auth.js';
import { sendWelcome, sendPasswordReset, mailEnabled } from '../mailer.js';
import { h, fail, randomPassword, nowIso, localDay, attachmentUpload, fileUrl, selfUser, deleteStoredFiles, attachmentUrls } from '../util.js';
import { notify, notifyStaff } from '../notify.js';
import { statistics, teamReport, normalizeRange, dailySummary } from '../analytics.js';
import { deliverEmail } from '../email.js';

const r = Router();
r.use(auth({ app: 'admin' }));

const STAFF_COLS = `id, user_code, username, email, full_name, avatar, role, status, team_leader_id, can_create_accounts,
  must_change_password, verified, job_title, created_at, last_login_at, last_active_at, created_by, signup_method, work_mode`;

// Resolve the team a request may look at. TL/SME are pinned to their own team.
function resolveTeam(req) {
  const scope = teamScope(req.user);
  if (scope !== null) return scope;
  return Number(req.query.teamLeaderId) || null;
}

// ---------- Statistics ----------
r.get('/stats', requireModule('stats'), h((req, res) => {
  const { from, to } = normalizeRange(req.query);
  const mood = MOOD_KEYS.includes(req.query.mood) ? req.query.mood : null;
  res.json({ ...statistics({ from, to, teamLeaderId: resolveTeam(req), mood }), scopedTeam: teamScope(req.user) });
}));

// ---------- Platform overview: users, Work Mode, content, teams and top activity ----------
// Counts only; no post, message or team content is exposed.
r.get('/platform', requireModule('stats'), h((req, res) => {
  const c = (sql, ...args) => get(sql, ...args).c;
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startWeek = new Date(startToday); startWeek.setDate(startWeek.getDate() - ((startWeek.getDay() + 6) % 7));
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const windowDays = Number(getSetting('active_window_days')) || 7;
  const activeSince = new Date(Date.now() - windowDays * 864e5).toISOString();
  const staff = STAFF_ROLES.map(() => '?').join(',');
  const users = all(`SELECT id, status, last_active_at, work_mode, created_at FROM users WHERE role NOT IN (${staff})`, ...STAFF_ROLES);
  const active = users.filter((u) => u.status === 'active');
  const after = (d) => users.filter((u) => u.created_at >= d.toISOString()).length;
  const teamRoles = all('SELECT m.role, COUNT(*) c FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.status = \'active\' GROUP BY m.role');
  const topMood = get('SELECT mood, COUNT(*) c FROM mood_logs WHERE created_at >= ? GROUP BY mood ORDER BY c DESC LIMIT 1', since);
  const mood = topMood && moodByKey(topMood.mood);
  const teamOut = (t) => ({ id: t.id, name: t.name, logo: t.logo, members: c('SELECT COUNT(*) c FROM team_members WHERE team_id = ?', t.id) });
  res.json({
    days,
    users: {
      registered: users.length,
      active: active.filter((u) => u.last_active_at && u.last_active_at >= activeSince).length,
      inactive: users.length - active.filter((u) => u.last_active_at && u.last_active_at >= activeSince).length,
      online: users.filter((u) => isOnline(u.id)).length,
      newToday: after(startToday),
      newWeek: after(startWeek),
      newMonth: after(startMonth),
      activeWindowDays: windowDays,
      staff: c(`SELECT COUNT(*) c FROM users WHERE role IN (${staff})`, ...STAFF_ROLES),
    },
    work: {
      enabled: active.filter((u) => u.work_mode).length,
      disabled: active.filter((u) => !u.work_mode).length,
      teams: c('SELECT COUNT(*) c FROM teams'),
      activeTeams: c("SELECT COUNT(*) c FROM teams WHERE status = 'active'"),
      newTeamsToday: c('SELECT COUNT(*) c FROM teams WHERE created_at >= ?', startToday.toISOString()),
    },
    content: {
      posts: c('SELECT COUNT(*) c FROM posts WHERE team_id IS NULL'),
      workPosts: c('SELECT COUNT(*) c FROM posts WHERE team_id IS NOT NULL'),
      stories: c('SELECT COUNT(*) c FROM stories'),
      notes: c('SELECT COUNT(*) c FROM notes'),
      messages: c("SELECT COUNT(*) c FROM messages WHERE kind != 'system'"),
      friendships: c("SELECT COUNT(*) c FROM friendships WHERE status = 'accepted'"),
    },
    teams: {
      roles: TEAM_ROLES.map((role) => ({ role, label: TEAM_ROLE_LABELS[role], count: teamRoles.find((x) => x.role === role)?.c || 0 })),
      members: c("SELECT COUNT(DISTINCT m.user_id) c FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.status = 'active'"),
    },
    top: {
      users: all(`SELECT u.id, u.full_name, u.username, u.avatar,
          (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.created_at >= ?) posts,
          (SELECT COUNT(*) FROM comments x WHERE x.user_id = u.id AND x.created_at >= ?) comments,
          (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id AND m.kind != 'system' AND m.created_at >= ?) messages,
          (SELECT COUNT(*) FROM stories s WHERE s.user_id = u.id AND s.created_at >= ?) stories
        FROM users u WHERE u.status = 'active' AND u.role NOT IN (${staff})`, since, since, since, since, ...STAFF_ROLES)
        .map((u) => ({ ...u, score: u.posts * 3 + u.stories * 2 + u.comments + u.messages })).filter((u) => u.score)
        .sort((a, b) => b.score - a.score).slice(0, 5),
      teams: all(`SELECT t.id, t.name, t.logo,
          (SELECT COUNT(*) FROM posts p WHERE p.team_id = t.id AND p.created_at >= ?) posts,
          (SELECT COUNT(*) FROM messages m JOIN conversations cv ON cv.id = m.conversation_id WHERE cv.team_id = t.id AND m.kind != 'system' AND m.created_at >= ?) messages,
          (SELECT COUNT(*) FROM schedules s WHERE s.team_id = t.id AND s.created_at >= ?) schedules
        FROM teams t WHERE t.status = 'active'`, since, since, since)
        .map((t) => ({ ...teamOut(t), posts: t.posts, messages: t.messages, schedules: t.schedules, score: t.posts * 3 + t.messages + t.schedules }))
        .filter((t) => t.score).sort((a, b) => b.score - a.score).slice(0, 5),
      mood: mood ? { key: topMood.mood, label: mood.label, emoji: mood.emoji, count: topMood.c } : null,
      locations: all(`SELECT place_name name, COUNT(*) count FROM stories WHERE place_name IS NOT NULL AND place_name != '' AND created_at >= ?
        GROUP BY place_name COLLATE NOCASE ORDER BY count DESC LIMIT 5`, since),
      teamChats: all(`SELECT cv.id, cv.name, t.name team, t.logo, COUNT(m.id) messages FROM conversations cv JOIN teams t ON t.id = cv.team_id
          JOIN messages m ON m.conversation_id = cv.id AND m.kind != 'system' AND m.created_at >= ?
        WHERE t.status = 'active' GROUP BY cv.id ORDER BY messages DESC LIMIT 5`, since),
    },
  });
}));

// ---------- Reports ----------
r.get('/reports/filters', requireModule('reports'), h((req, res) => {
  const scope = teamScope(req.user);
  const tls = scope !== null
    ? all("SELECT id, full_name, user_code FROM users WHERE id = ? AND role = 'tl'", scope)
    : all("SELECT id, full_name, user_code FROM users WHERE role = 'tl' ORDER BY full_name");
  const tlIds = tls.map((t) => t.id);
  const ph = tlIds.map(() => '?').join(',') || 'NULL';
  res.json({
    teamLeaders: tls,
    smes: all(`SELECT id, full_name, user_code, team_leader_id FROM users WHERE role = 'sme' AND (team_leader_id IN (${ph}) ${scope === null ? 'OR 1' : ''}) ORDER BY full_name`, ...tlIds),
    agents: all(`SELECT id, full_name, user_code, team_leader_id FROM users WHERE role = 'agent' AND (team_leader_id IN (${ph}) ${scope === null ? 'OR 1' : ''}) ORDER BY full_name`, ...tlIds),
  });
}));

r.get('/reports/team-leaders', requireModule('reports'), h((req, res) => {
  const { from, to } = normalizeRange(req.query);
  const scope = teamScope(req.user);
  const tls = scope !== null
    ? all("SELECT id FROM users WHERE id = ? AND role = 'tl'", scope)
    : all("SELECT id FROM users WHERE role = 'tl' ORDER BY full_name");
  res.json(tls.map(({ id }) => {
    const rep = teamReport(id, { from, to });
    return { ...rep.teamLeader, summary: rep.summary };
  }));
}));

r.get('/reports/team-leaders/:id', requireModule('reports'), h((req, res) => {
  const id = Number(req.params.id);
  const scope = teamScope(req.user);
  if (scope !== null && scope !== id) fail(403, 'You can only view your own team.');
  const { from, to } = normalizeRange(req.query);
  const rep = teamReport(id, {
    from, to,
    mood: MOOD_KEYS.includes(req.query.mood) ? req.query.mood : null,
    agentId: Number(req.query.agentId) || null,
    smeId: Number(req.query.smeId) || null,
  });
  if (!rep || rep.teamLeader.role !== 'tl') fail(404, 'Team leader not found.');
  res.json(rep);
}));

// Raw mood log, filterable by TL / SME / agent / date range / mood.
r.get('/reports/moods', requireModule('reports'), h((req, res) => {
  const { from, to } = normalizeRange(req.query);
  const scope = teamScope(req.user);
  const tl = scope !== null ? scope : Number(req.query.teamLeaderId) || null;
  const userId = Number(req.query.agentId) || Number(req.query.smeId) || null;
  const mood = MOOD_KEYS.includes(req.query.mood) ? req.query.mood : null;
  const rows = all(
    `SELECT l.id, l.mood, l.source, l.day, l.created_at, u.id AS user_id, u.full_name, u.user_code, u.role, t.full_name AS team_leader
     FROM mood_logs l JOIN users u ON u.id = l.user_id LEFT JOIN users t ON t.id = u.team_leader_id
     WHERE l.day BETWEEN ? AND ?
       AND (? IS NULL OR u.team_leader_id = ? OR u.id = ?)
       AND (? IS NULL OR u.id = ?)
       AND (? IS NULL OR l.mood = ?)
     ORDER BY l.id DESC LIMIT 1000`,
    from, to, tl, tl, tl, userId, userId, mood, mood
  );
  res.json(rows);
}));

// ---------- Moderation: content reports and support requests ----------
const REPORT_STATUS = ['open', 'resolved', 'dismissed'];
function reportTarget(r) {
  const who = (id) => (id ? get('SELECT id, full_name, user_code, avatar, status FROM users WHERE id = ?', id) : null);
  switch (r.target_type) {
    case 'user': { const u = who(r.target_id); return u && { label: u.full_name, sub: u.user_code, user: u }; }
    case 'post': { const p = get('SELECT id, user_id, text, team_id FROM posts WHERE id = ?', r.target_id); return p && { label: p.text.slice(0, 200) || '(photo post)', sub: p.team_id ? 'Work post' : 'Post', user: who(p.user_id), removable: true }; }
    case 'story': { const st = get('SELECT id, user_id, text FROM stories WHERE id = ?', r.target_id); return st && { label: st.text.slice(0, 200) || '(photo story)', sub: 'Story', user: who(st.user_id), removable: true }; }
    case 'comment': { const c = get('SELECT id, user_id, text FROM comments WHERE id = ?', r.target_id); return c && { label: c.text.slice(0, 200), sub: 'Comment', user: who(c.user_id), removable: true }; }
    case 'conversation': { const c = get('SELECT id, name, type, team_id FROM conversations WHERE id = ?', r.target_id); return c && { label: c.name || 'Direct chat', sub: c.team_id ? 'Team channel' : 'Group chat' }; }
    default: return null;
  }
}
r.get('/content-reports', requireModule('reports'), h((req, res) => {
  const support = req.query.kind === 'support';
  const status = REPORT_STATUS.includes(req.query.status) ? req.query.status : '';
  const rows = all(`SELECT * FROM reports WHERE ${support ? "target_type = 'support'" : "target_type != 'support'"} AND (? = '' OR status = ?) ORDER BY status = 'open' DESC, id DESC LIMIT 300`, status, status);
  res.json(rows.map((x) => ({
    ...x,
    reporter: x.reporter_id ? get('SELECT id, full_name, email, user_code, avatar FROM users WHERE id = ?', x.reporter_id) : null,
    target: support ? null : reportTarget(x),
  })));
}));
r.patch('/content-reports/:id', requireModule('reports'), h((req, res) => {
  const x = get('SELECT * FROM reports WHERE id = ?', Number(req.params.id)) || fail(404, 'Report not found.');
  if (!REPORT_STATUS.includes(req.body?.status)) fail(400, 'Choose open, resolved or dismissed.');
  run('UPDATE reports SET status = ? WHERE id = ?', req.body.status, x.id);
  res.json({ ok: true });
}));
// Remove the reported post, story or comment, and resolve the report. The author is told why.
r.post('/content-reports/:id/remove', requireModule('reports'), h((req, res) => {
  const x = get('SELECT * FROM reports WHERE id = ?', Number(req.params.id)) || fail(404, 'Report not found.');
  const table = { post: 'posts', story: 'stories', comment: 'comments' }[x.target_type];
  if (!table) fail(400, 'Only posts, stories and comments can be removed here.');
  const row = get(`SELECT id, user_id FROM ${table} WHERE id = ?`, x.target_id);
  if (row) {
    run(`DELETE FROM ${table} WHERE id = ?`, row.id);
    notify({ userId: row.user_id, type: 'system', title: 'Content removed', body: `Your ${x.target_type} was removed by Hunch moderators for breaking the community guidelines.` });
  }
  run("UPDATE reports SET status = 'resolved' WHERE target_type = ? AND target_id = ? AND status = 'open'", x.target_type, x.target_id);
  res.json({ ok: true, removed: !!row });
}));

// ---------- Announcements & daily reports ----------
r.post('/announcements', requireModule('notifications'), h((req, res) => {
  if (!['developer', 'sysadmin', 'employee', 'operations'].includes(req.user.role)) fail(403, 'Customer Support can’t post announcements.');
  const { title = '', body = '', kind = 'announcement', audience = 'everyone' } = req.body || {};
  if (!title.trim() || !body.trim()) fail(400, 'Title and message are required.');
  if (!['announcement', 'app_update'].includes(kind)) fail(400, 'Invalid type.');
  if (kind === 'app_update' && req.user.role !== 'developer') fail(403, 'Only developers can publish app updates.');
  // 'agents' (old clients) means everyone who is not staff.
  if (!['everyone', 'staff', 'agents', 'users'].includes(audience)) fail(400, 'Invalid audience.');
  const id = Number(run('INSERT INTO announcements (kind, title, body, audience, created_by) VALUES (?, ?, ?, ?, ?)', kind, title.trim(), body.trim(), audience, req.user.id).lastInsertRowid);
  const recipients = all("SELECT id, role FROM users WHERE status = 'active'");
  const type = kind === 'app_update' ? 'app_update' : 'announcement';
  for (const u of recipients) {
    const isStaff = isStaffRole(u.role);
    if (audience === 'staff' && !isStaff) continue;
    if (['agents', 'users'].includes(audience) && isStaff) continue;
    notify({ userId: u.id, audience: 'client', type, actorId: req.user.id, entityType: 'announcement', entityId: id, title: title.trim(), body: body.trim() });
    if (isStaff) notify({ userId: u.id, audience: 'admin', type, actorId: req.user.id, entityType: 'announcement', entityId: id, title: title.trim(), body: body.trim() });
  }
  res.status(201).json({ id });
}));

r.get('/announcements', requireModule('notifications'), h((_req, res) => {
  res.json(all('SELECT a.*, u.full_name AS author FROM announcements a LEFT JOIN users u ON u.id = a.created_by ORDER BY a.id DESC LIMIT 100'));
}));

export function sendDailyReports(day = localDay()) {
  const staff = all(`SELECT * FROM users WHERE status = 'active' AND role IN (${STAFF_ROLES.map(() => '?').join(',')})`, ...STAFF_ROLES);
  let sent = 0;
  for (const u of staff) {
    const scope = teamScope(u);
    const s = dailySummary(day, scope);
    const top = s.topMoods.map((m) => `${m.emoji} ${m.label} ${m.pct}%`).join(', ') || 'no moods logged';
    notify({
      userId: u.id, audience: 'admin', type: 'daily_report', entityType: 'daily_report',
      title: `Daily report · ${day}${scope ? ' · your team' : ''}`,
      body: `Participation ${s.participationPct}% (${s.participants}/${s.activeUsers}). Top moods: ${top}. Team mood is ${s.trend}. ${s.present} active today.`,
      data: s,
    });
    sent += 1;
  }
  setSetting('last_daily_report', day);
  return sent;
}

r.post('/reports/daily/generate', requireModule('notifications'), h((req, res) => {
  if (!['developer', 'sysadmin', 'operations'].includes(req.user.role)) fail(403, 'Only developers, system administrators and operations can trigger daily reports.');
  res.json({ sent: sendDailyReports() });
}));

r.get('/reports/daily', requireModule('notifications'), h((req, res) => {
  res.json(dailySummary(/^\d{4}-\d{2}-\d{2}$/.test(req.query.day || '') ? req.query.day : localDay(), teamScope(req.user)));
}));

// ---------- Account registration ----------
r.get('/accounts/options', h((req, res) => {
  // Registration creates Hunch staff accounts only; everyone else signs up in the Hunch app.
  res.json({ roles: creatableRoles(req.user), teamLeaders: [] });
}));

function createAccount(creator, body) {
  const allowed = creatableRoles(creator);
  if (!allowed.length) fail(403, 'You do not have permission to create accounts.');
  const full_name = String(body.full_name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const username = String(body.username || '').trim() || null;
  const role = String(body.role || '');
  if (!full_name) fail(400, 'Full name is required.');
  if (!/^\S+@\S+\.\S+$/.test(email)) fail(400, 'A valid email is required.');
  if (username && !/^[A-Za-z0-9._-]{3,30}$/.test(username)) fail(400, 'Username must be 3–30 letters, numbers, dots, dashes or underscores.');
  if (!allowed.includes(role)) fail(403, `You can't create ${ROLE_LABELS[role] || role} accounts.`);
  if (get('SELECT id FROM users WHERE email = ?', email)) fail(409, 'That email is already registered.');
  if (username && get('SELECT id FROM users WHERE username = ?', username)) fail(409, 'That username is taken.');
  const temp = randomPassword();
  const id = tx(() => {
    const id = Number(run(
      `INSERT INTO users (username, email, password_hash, full_name, role, job_title, must_change_password, verified, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)`,
      username, email, bcrypt.hashSync(temp, 10), full_name, role, String(body.job_title || ROLE_LABELS[role]).slice(0, 80), creator.id
    ).lastInsertRowid);
    run('UPDATE users SET user_code = ? WHERE id = ?', codeFor(id), id);
    return id;
  });
  notifyStaff({
    roles: ['developer', 'sysadmin'], type: 'new_user', actorId: creator.id, entityType: 'user', entityId: id,
    title: 'New user registered', body: `${creator.full_name} created a ${ROLE_LABELS[role]} account for ${full_name}.`,
  });
  // Email the new person their sign-in details (only when SMTP is configured and the address is real).
  sendWelcome(email, full_name.split(' ')[0], username || email, temp, role).then((ok) => ok && console.log(`[hunch] Welcome email sent to new ${role}.`));
  return { user: get(`SELECT ${STAFF_COLS} FROM users WHERE id = ?`, id), tempPassword: temp, emailed: mailEnabled() };
}

r.post('/accounts', h((req, res) => {
  const out = createAccount(req.user, req.body || {});
  const reqId = Number(req.body?.request_id);
  if (reqId) run("UPDATE account_requests SET status = 'approved', handled_by = ? WHERE id = ?", req.user.id, reqId);
  res.status(201).json(out);
}));

r.get('/account-requests', requireModule('register'), h((req, res) => {
  res.json(all("SELECT * FROM account_requests ORDER BY status = 'pending' DESC, id DESC LIMIT 200"));
}));

r.post('/account-requests/:id/reject', requireModule('register'), h((req, res) => {
  run("UPDATE account_requests SET status = 'rejected', handled_by = ? WHERE id = ?", req.user.id, Number(req.params.id));
  res.json({ ok: true });
}));

// ---------- User management ----------
r.get('/users', requireModule('users'), h((req, res) => {
  const q = String(req.query.q || '').trim();
  const role = String(req.query.role || '');
  const status = String(req.query.status || '');
  const rows = all(
    `SELECT ${STAFF_COLS.split(',').map((c) => 'u.' + c.trim()).join(', ')}, t.full_name AS team_leader_name,
       (SELECT COUNT(*) FROM password_reset_requests p WHERE p.user_id = u.id AND p.status = 'pending') AS reset_pending
     FROM users u LEFT JOIN users t ON t.id = u.team_leader_id
     WHERE (? = '' OR u.full_name LIKE ? OR u.email LIKE ? OR u.user_code LIKE ? OR u.username LIKE ?)
       AND (? = '' OR u.role = ?) AND (? = '' OR u.status = ?)
     ORDER BY u.id DESC LIMIT 500`,
    q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, role, role, status, status
  );
  res.json({ users: rows, manageable: manageableRoles(req.user), assignable: assignableRoles(req.user) });
}));

r.patch('/users/:id', requireModule('users'), h((req, res) => {
  const target = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!target) fail(404, 'User not found.');
  const can = manageableRoles(req.user);
  if (!can.includes(target.role)) fail(403, "You can't manage this account.");
  if (target.id === req.user.id && (req.body.status === 'disabled' || (req.body.role && req.body.role !== target.role))) fail(400, "You can't disable or demote yourself.");
  const b = req.body || {};
  if (b.role !== undefined && b.role !== target.role) {
    if (!assignableRoles(req.user).includes(b.role)) fail(403, "You can't assign that role.");
    if ((isStaffRole(b.role) || isStaffRole(target.role)) && !modulesFor(req.user).includes('admins')) fail(403, 'Only developers and system administrators can manage staff roles.');
  }
  const sets = [];
  const vals = [];
  const setField = (k, v) => { sets.push(`${k} = ?`); vals.push(v); };
  if (b.full_name !== undefined) setField('full_name', String(b.full_name).trim().slice(0, 80) || target.full_name);
  if (b.email !== undefined) {
    const e = String(b.email).trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) fail(400, 'Invalid email.');
    if (get('SELECT id FROM users WHERE email = ? AND id != ?', e, target.id)) fail(409, 'Email already in use.');
    setField('email', e);
  }
  if (b.job_title !== undefined) setField('job_title', String(b.job_title).slice(0, 80));
  if (b.role !== undefined) setField('role', b.role);
  if (b.status !== undefined) {
    if (!['active', 'disabled'].includes(b.status)) fail(400, 'Invalid status.');
    setField('status', b.status);
  }
  if (sets.length) run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...vals, target.id);
  res.json(get(`SELECT ${STAFF_COLS} FROM users WHERE id = ?`, target.id));
}));

r.post('/users/:id/reset-password', requireModule('users'), h((req, res) => {
  const target = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!target) fail(404, 'User not found.');
  if (!manageableRoles(req.user).includes(target.role)) fail(403, "You can't manage this account.");
  const temp = randomPassword();
  run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', bcrypt.hashSync(temp, 10), target.id);
  run("UPDATE password_reset_requests SET status = 'resolved', handled_by = ? WHERE user_id = ? AND status = 'pending'", req.user.id, target.id);
  sendPasswordReset(target.email, target.full_name.split(' ')[0], temp, target.role);
  res.json({ tempPassword: temp, emailed: mailEnabled() });
}));

r.get('/password-requests', requireModule('users'), h((req, res) => {
  res.json(all(
    `SELECT p.*, u.full_name, u.email, u.user_code, u.role FROM password_reset_requests p JOIN users u ON u.id = p.user_id
     ORDER BY p.status = 'pending' DESC, p.id DESC LIMIT 200`
  ));
}));

// ---------- Admin management (developer) ----------
r.get('/admins', requireModule('admins'), h((_req, res) => {
  res.json(all(`SELECT ${STAFF_COLS} FROM users WHERE role IN (${STAFF_ROLES.map(() => '?').join(',')}) ORDER BY CASE role WHEN 'developer' THEN 0 WHEN 'sysadmin' THEN 1 ELSE 2 END, full_name`, ...STAFF_ROLES));
}));

// ---------- System settings (developer) ----------
r.get('/settings', requireModule('settings'), h((_req, res) => {
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = getSetting(k);
  const counts = {
    users: get('SELECT COUNT(*) c FROM users').c,
    posts: get('SELECT COUNT(*) c FROM posts').c,
    messages: get('SELECT COUNT(*) c FROM messages').c,
    moodLogs: get('SELECT COUNT(*) c FROM mood_logs').c,
    emails: get('SELECT COUNT(*) c FROM emails').c,
  };
  res.json({ settings: out, counts, server: { node: process.version, startedAt: START, now: nowIso() } });
}));
const START = nowIso();

r.put('/settings', requireModule('settings'), h((req, res) => {
  const b = req.body || {};
  const numeric = { story_hours: [1, 168], note_hours: [1, 168], note_max_words: [5, 100], active_window_days: [1, 90], daily_report_hour: [0, 23] };
  for (const [k, v] of Object.entries(b)) {
    if (!(k in DEFAULT_SETTINGS) || k === 'last_daily_report') continue;
    if (numeric[k]) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < numeric[k][0] || n > numeric[k][1]) fail(400, `${k} must be between ${numeric[k][0]} and ${numeric[k][1]}.`);
    }
    setSetting(k, k === 'allow_account_requests' ? (v === true || v === '1' || v === 1 ? '1' : '0') : String(v).slice(0, 300));
  }
  res.json({ ok: true });
}));

// ---------- Email ----------
const emailOut = (e) => ({
  ...e,
  to_list: JSON.parse(e.to_list), cc_list: JSON.parse(e.cc_list), attachments: JSON.parse(e.attachments), external: JSON.parse(e.external),
  from_name: e.from_id ? get('SELECT full_name FROM users WHERE id = ?', e.from_id)?.full_name : null,
});

r.get('/email/recipients', requireModule('email'), h((req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  res.json(all("SELECT id, full_name, email, role, avatar FROM users WHERE status = 'active' AND (full_name LIKE ? OR email LIKE ?) ORDER BY full_name LIMIT 10", q, q));
}));

r.get('/email/counts', requireModule('email'), h((req, res) => {
  const c = (f, extra = '') => get(`SELECT COUNT(*) c FROM emails WHERE owner_id = ? AND folder = ? ${extra}`, req.user.id, f).c;
  res.json({ inbox: c('inbox', 'AND is_read = 0'), drafts: c('drafts'), scheduled: c('scheduled') });
}));

r.get('/email', requireModule('email'), h((req, res) => {
  const folder = ['inbox', 'sent', 'drafts', 'scheduled', 'trash'].includes(req.query.folder) ? req.query.folder : 'inbox';
  const q = String(req.query.q || '').trim();
  const rows = all(
    `SELECT * FROM emails WHERE owner_id = ? AND folder = ?
       AND (? = '' OR subject LIKE ? OR body LIKE ? OR from_email LIKE ? OR to_list LIKE ?)
     ORDER BY COALESCE(sent_at, scheduled_at, updated_at) DESC LIMIT 200`,
    req.user.id, folder, q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`
  );
  res.json(rows.map(emailOut));
}));

r.get('/email/templates', requireModule('email'), h((_req, res) => {
  res.json(all('SELECT t.*, u.full_name AS author FROM email_templates t LEFT JOIN users u ON u.id = t.created_by ORDER BY t.name'));
}));
r.post('/email/templates', requireModule('email'), h((req, res) => {
  const { name = '', subject = '', body = '' } = req.body || {};
  if (!name.trim()) fail(400, 'Template name is required.');
  const id = Number(run('INSERT INTO email_templates (name, subject, body, created_by) VALUES (?, ?, ?, ?)', name.trim(), subject, body, req.user.id).lastInsertRowid);
  res.status(201).json(get('SELECT * FROM email_templates WHERE id = ?', id));
}));
r.put('/email/templates/:id', requireModule('email'), h((req, res) => {
  const t = get('SELECT * FROM email_templates WHERE id = ?', Number(req.params.id));
  if (!t) fail(404, 'Template not found.');
  if (t.created_by !== req.user.id && !['developer', 'sysadmin'].includes(req.user.role)) fail(403, 'You can only edit your own templates.');
  const { name = t.name, subject = t.subject, body = t.body } = req.body || {};
  if (!String(name).trim()) fail(400, 'Template name is required.');
  run('UPDATE email_templates SET name = ?, subject = ?, body = ?, updated_at = ? WHERE id = ?', String(name).trim(), subject, body, nowIso(), t.id);
  res.json(get('SELECT * FROM email_templates WHERE id = ?', t.id));
}));
r.delete('/email/templates/:id', requireModule('email'), h((req, res) => {
  const t = get('SELECT * FROM email_templates WHERE id = ?', Number(req.params.id));
  if (!t) fail(404, 'Template not found.');
  if (t.created_by !== req.user.id && !['developer', 'sysadmin'].includes(req.user.role)) fail(403, 'You can only delete your own templates.');
  run('DELETE FROM email_templates WHERE id = ?', t.id);
  res.json({ ok: true });
}));

r.get('/email/:id', requireModule('email'), h((req, res) => {
  const e = get('SELECT * FROM emails WHERE id = ? AND owner_id = ?', Number(req.params.id), req.user.id);
  if (!e) fail(404, 'Email not found.');
  if (!e.is_read) run('UPDATE emails SET is_read = 1 WHERE id = ?', e.id);
  res.json(emailOut({ ...e, is_read: 1 }));
}));

const parseList = (v) => {
  if (Array.isArray(v)) return v.map(String);
  try { const p = JSON.parse(v || '[]'); return Array.isArray(p) ? p.map(String) : []; } catch { return String(v || '').split(/[,;\s]+/); }
};

/**
 * Compose: action = send | draft | schedule. Multipart so attachments can be added.
 * Existing attachments (from a draft) are passed back in `keep_attachments`.
 */
r.post('/email', requireModule('email'), attachmentUpload.array('attachments', 10), h((req, res) => {
  const b = req.body || {};
  const action = ['send', 'draft', 'schedule'].includes(b.action) ? b.action : 'send';
  const to = parseList(b.to).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const cc = parseList(b.cc).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const kept = parseList(b.keep_attachments).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  const attachments = [...kept, ...(req.files || []).map((f) => ({ name: f.originalname, url: fileUrl(f), size: f.size, type: f.mimetype }))];
  const subject = String(b.subject || '').slice(0, 300);
  const body = String(b.body || '').slice(0, 100000);
  if (action !== 'draft') {
    if (!to.length) fail(400, 'Add at least one recipient.');
    const bad = [...to, ...cc].find((e) => !/^\S+@\S+\.\S+$/.test(e));
    if (bad) fail(400, `"${bad}" is not a valid email address.`);
    if (!subject.trim()) fail(400, 'Subject is required.');
  }
  let scheduledAt = null;
  if (action === 'schedule') {
    const d = new Date(b.scheduled_at);
    if (isNaN(d)) fail(400, 'Choose a valid schedule time.');
    if (d.getTime() < Date.now() + 30e3) fail(400, 'Schedule time must be in the future.');
    scheduledAt = d.toISOString();
  }
  const folder = action === 'draft' ? 'drafts' : action === 'schedule' ? 'scheduled' : 'sent';
  const draftId = Number(b.draft_id) || null;
  const values = [JSON.stringify(to), JSON.stringify(cc), subject, body, JSON.stringify(attachments), Number(b.template_id) || null, scheduledAt];
  let id;
  if (draftId && get("SELECT id FROM emails WHERE id = ? AND owner_id = ? AND folder IN ('drafts','scheduled')", draftId, req.user.id)) {
    run(`UPDATE emails SET folder = ?, to_list = ?, cc_list = ?, subject = ?, body = ?, attachments = ?, template_id = ?, scheduled_at = ?, updated_at = ? WHERE id = ?`,
      folder, ...values, nowIso(), draftId);
    id = draftId;
  } else {
    id = Number(run(`INSERT INTO emails (owner_id, folder, from_id, from_email, to_list, cc_list, subject, body, attachments, template_id, scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, req.user.id, folder, req.user.id, req.user.email, ...values).lastInsertRowid);
  }
  if (action === 'send') deliverEmail(id);
  res.status(201).json(emailOut(get('SELECT * FROM emails WHERE id = ?', id)));
}));

r.post('/email/:id/cancel-schedule', requireModule('email'), h((req, res) => {
  const e = get("SELECT * FROM emails WHERE id = ? AND owner_id = ? AND folder = 'scheduled'", Number(req.params.id), req.user.id);
  if (!e) fail(404, 'Scheduled email not found.');
  run("UPDATE emails SET folder = 'drafts', scheduled_at = NULL WHERE id = ?", e.id);
  res.json({ ok: true });
}));

r.delete('/email/:id', requireModule('email'), h((req, res) => {
  const e = get('SELECT * FROM emails WHERE id = ? AND owner_id = ?', Number(req.params.id), req.user.id);
  if (!e) fail(404, 'Email not found.');
  if (e.folder === 'trash' || e.folder === 'drafts') {
    run('DELETE FROM emails WHERE id = ?', e.id);
    deleteStoredFiles(attachmentUrls(e.attachments)); // kept while any other copy of the email still has it
  }
  else run("UPDATE emails SET folder = 'trash' WHERE id = ?", e.id);
  res.json({ ok: true });
}));

r.post('/email/:id/read', requireModule('email'), h((req, res) => {
  run('UPDATE emails SET is_read = ? WHERE id = ? AND owner_id = ?', req.body?.read === false ? 0 : 1, Number(req.params.id), req.user.id);
  res.json({ ok: true });
}));

r.get('/me', h((req, res) => res.json(selfUser(req.user))));

export default r;
