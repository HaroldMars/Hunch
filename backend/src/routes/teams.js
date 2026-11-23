import { Router } from 'express';
import { get, all, run, tx } from '../db.js';
import { auth, requireModule, teamScope } from '../auth.js';
import { h, fail, localDay, addDays } from '../util.js';
import { notify } from '../notify.js';
import { isOverseer } from '../teams.js';
import { POSITIVE } from '../analytics.js';

// Team Management (admin dashboard).
// Developers and managers create teams, assign TLs/SMEs and assign or transfer agents.
// TLs and SMEs get a read-only view of their own team. Only developers can delete a team.
//
// Membership stays on users.team_leader_id (the team's TL), so the Work feed, schedules, reports,
// mood analytics and notifications follow an assignment automatically.

const r = Router();
r.use(auth({ app: 'admin' }), requireModule('teams'));

const COLOR = /^#[0-9a-fA-F]{6}$/;
const MEMBER_COLS = 'id, user_code, full_name, email, avatar, role, status, job_title, last_active_at, team_leader_id';

const mustOversee = (req) => { if (!isOverseer(req.user)) fail(403, 'Only managers and developers can change teams.'); };
const teamById = (id) => get('SELECT * FROM teams WHERE id = ?', Number(id)) || fail(404, 'Team not found.');
const person = (id) => (id ? get(`SELECT ${MEMBER_COLS} FROM users WHERE id = ?`, id) : null);
const range = (q) => {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : localDay();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : addDays(to, -29);
  return from <= to ? { from, to } : { from: to, to: from };
};
const ph = (a) => a.map(() => '?').join(',') || 'NULL';

/** The team ids (teams.id) this user may look at; null = all of them. */
function visibleTeamIds(u) {
  const scope = teamScope(u);
  if (scope === null) return null;
  return all('SELECT id FROM teams WHERE tl_id = ?', scope).map((t) => t.id);
}
function mustSee(req, team) {
  const ids = visibleTeamIds(req.user);
  if (ids && !ids.includes(team.id)) fail(403, 'You can only view your own team.');
}

const membersOf = (team) => (team.tl_id
  ? all(`SELECT ${MEMBER_COLS} FROM users WHERE team_leader_id = ? AND role IN ('sme','agent') ORDER BY full_name COLLATE NOCASE`, team.tl_id)
  : []);

function moodMix(userIds, { from, to }) {
  if (!userIds.length) return { total: 0, positive: 0, moods: [] };
  const rows = all(`SELECT mood, COUNT(*) c FROM mood_logs WHERE user_id IN (${ph(userIds)}) AND day BETWEEN ? AND ? GROUP BY mood ORDER BY c DESC`, ...userIds, from, to);
  const total = rows.reduce((a, b) => a + b.c, 0);
  const pos = rows.filter((m) => POSITIVE.includes(m.mood)).reduce((a, b) => a + b.c, 0);
  return {
    total,
    positive: total ? Math.round((pos / total) * 100) : 0,
    moods: rows.map((m) => ({ mood: m.mood, count: m.c, pct: Math.round((m.c / total) * 1000) / 10 })),
  };
}

function teamOut(team, { detail = false, period = range({}) } = {}) {
  const members = membersOf(team);
  const smes = members.filter((m) => m.role === 'sme');
  const agents = members.filter((m) => m.role === 'agent');
  const tl = person(team.tl_id);
  const ids = [tl?.id, ...members.map((m) => m.id)].filter(Boolean);
  const out = {
    ...team,
    tl,
    sme: person(team.sme_id),
    manager: person(team.manager_id),
    counts: { smes: smes.length, agents: agents.length, total: ids.length },
    mood: moodMix(ids, period),
  };
  if (detail) {
    const lastMood = (uid) => get('SELECT mood, day FROM mood_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1', uid) || null;
    const withMood = (u) => u && { ...u, last_mood: lastMood(u.id) };
    out.members = { tl: withMood(tl), smes: smes.map(withMood), agents: agents.map(withMood) };
    out.period = period;
  }
  return out;
}

const notifyMember = (userId, actorId, title, body) => notify({ userId, audience: 'client', type: 'team', actorId, entityType: 'team', title, body });
const notifyLeader = (tlId, actorId, title, body) => tlId && notify({ userId: tlId, audience: 'admin', type: 'team', actorId, entityType: 'team', title, body });

// ---------- read ----------
r.get('/', h((req, res) => {
  const ids = visibleTeamIds(req.user);
  const status = ['active', 'archived'].includes(req.query.status) ? req.query.status : null;
  const rows = ids === null
    ? all(`SELECT * FROM teams WHERE (? IS NULL OR status = ?) ORDER BY status, name COLLATE NOCASE`, status, status)
    : all(`SELECT * FROM teams WHERE id IN (${ph(ids)})`, ...ids);
  const period = range(req.query);
  res.json({
    teams: rows.map((t) => teamOut(t, { period })),
    canManage: isOverseer(req.user),
    canDelete: req.user.role === 'developer',
    unassigned: isOverseer(req.user)
      ? get(`SELECT COUNT(*) c FROM users WHERE role IN ('agent','sme') AND status = 'active'
             AND (team_leader_id IS NULL OR team_leader_id NOT IN (SELECT tl_id FROM teams WHERE status = 'active' AND tl_id IS NOT NULL))`).c
      : 0,
  });
}));

// People available for the create/edit forms and the assignment list.
r.get('/options', h((req, res) => {
  mustOversee(req);
  res.json({
    managers: all("SELECT id, full_name, user_code, avatar FROM users WHERE role = 'manager' AND status = 'active' ORDER BY full_name COLLATE NOCASE"),
    departments: all("SELECT DISTINCT department FROM teams WHERE department != '' ORDER BY department COLLATE NOCASE").map((d) => d.department),
    teamLeaders: all(`SELECT u.id, u.full_name, u.user_code, u.avatar, t.id team_id, t.name team_name
      FROM users u LEFT JOIN teams t ON t.tl_id = u.id WHERE u.role = 'tl' AND u.status = 'active' ORDER BY u.full_name COLLATE NOCASE`),
    smes: all(`SELECT u.id, u.full_name, u.user_code, u.avatar, u.team_leader_id, t.id team_id, t.name team_name
      FROM users u LEFT JOIN teams t ON t.tl_id = u.team_leader_id WHERE u.role = 'sme' AND u.status = 'active' ORDER BY u.full_name COLLATE NOCASE`),
    people: all(`SELECT u.id, u.full_name, u.user_code, u.avatar, u.role, u.job_title, u.last_active_at, t.id team_id, t.name team_name, t.color team_color
      FROM users u LEFT JOIN teams t ON t.tl_id = u.team_leader_id AND t.status = 'active'
      WHERE u.role IN ('agent','sme') AND u.status = 'active' ORDER BY (t.id IS NOT NULL), u.full_name COLLATE NOCASE`),
  });
}));

// Mood comparison across teams (Reports + Team Management).
r.get('/compare', h((req, res) => {
  const ids = visibleTeamIds(req.user);
  const period = range(req.query);
  const rows = ids === null
    ? all("SELECT * FROM teams WHERE status = 'active' ORDER BY name COLLATE NOCASE")
    : all(`SELECT * FROM teams WHERE id IN (${ph(ids)})`, ...ids);
  res.json({ period, teams: rows.map((t) => { const o = teamOut(t, { period }); return { id: o.id, name: o.name, color: o.color, tl: o.tl, counts: o.counts, mood: o.mood }; }) });
}));

// One member's profile, mood analytics, work activity and schedule.
r.get('/member/:uid', h((req, res) => {
  const u = get(`SELECT ${MEMBER_COLS}, created_at, last_login_at FROM users WHERE id = ?`, Number(req.params.uid)) || fail(404, 'User not found.');
  const tlId = u.role === 'tl' ? u.id : u.team_leader_id;
  const scope = teamScope(req.user);
  const ownManager = u.role === 'manager' && scope !== null && get('SELECT 1 x FROM teams WHERE tl_id = ? AND manager_id = ?', scope, u.id);
  if (scope !== null && scope !== tlId && !ownManager) fail(403, 'You can only view members of your own team.');
  const period = range(req.query);
  const team = tlId ? get('SELECT id, name, color FROM teams WHERE tl_id = ?', tlId) : null;
  const today = localDay();
  res.json({
    user: u,
    team,
    period,
    mood: moodMix([u.id], period),
    recentMoods: all('SELECT mood, day, source FROM mood_logs WHERE user_id = ? ORDER BY id DESC LIMIT 7', u.id),
    attendanceDays: get('SELECT COUNT(*) c FROM activity_days WHERE user_id = ? AND day BETWEEN ? AND ?', u.id, period.from, period.to).c,
    workPosts: tlId ? all('SELECT id, kind, text, created_at FROM posts WHERE user_id = ? AND team_id = ? ORDER BY id DESC LIMIT 5', u.id, tlId) : [],
    workPostCount: tlId ? get('SELECT COUNT(*) c FROM posts WHERE user_id = ? AND team_id = ?', u.id, tlId).c : 0,
    schedule: tlId
      ? all('SELECT id, kind, title, day, start_time, end_time FROM schedules WHERE team_id = ? AND day BETWEEN ? AND ? AND (user_id IS NULL OR user_id = ?) ORDER BY day, start_time LIMIT 20',
        tlId, today, addDays(today, 13), u.id)
      : [],
  });
}));

r.get('/:id', h((req, res) => {
  const team = teamById(req.params.id);
  mustSee(req, team);
  res.json({ team: teamOut(team, { detail: true, period: range(req.query) }), canManage: isOverseer(req.user), canDelete: req.user.role === 'developer' });
}));

// ---------- write (managers & developers) ----------
function readTeam(body, current = {}) {
  const v = {};
  if (body.name !== undefined || !current.id) {
    v.name = String(body.name ?? '').trim().slice(0, 60);
    if (!v.name) fail(400, 'Team name is required.');
    if (get("SELECT id FROM teams WHERE name = ? COLLATE NOCASE AND id != ? AND status = 'active'", v.name, current.id || 0)) fail(409, 'Another team already uses that name.');
  }
  if (body.department !== undefined || !current.id) v.department = String(body.department ?? '').trim().slice(0, 60) || 'Social Media';
  if (body.manager_id !== undefined) {
    const m = Number(body.manager_id) || null;
    if (m && !get("SELECT id FROM users WHERE id = ? AND role = 'manager' AND status = 'active'", m)) fail(400, 'Choose an active manager.');
    v.manager_id = m;
  }
  if (body.description !== undefined) v.description = String(body.description || '').trim().slice(0, 300);
  if (body.color !== undefined) { if (!COLOR.test(body.color)) fail(400, 'Pick a team colour.'); v.color = body.color; }
  if (body.status !== undefined) { if (!['active', 'archived'].includes(body.status)) fail(400, 'Invalid team status.'); v.status = body.status; }
  if (body.tl_id !== undefined || !current.id) {
    const tl = Number(body.tl_id) || null;
    if (!tl) fail(400, 'Choose a team leader.');
    if (!get("SELECT id FROM users WHERE id = ? AND role = 'tl' AND status = 'active'", tl)) fail(400, 'Choose an active team leader.');
    const other = get('SELECT name FROM teams WHERE tl_id = ? AND id != ?', tl, current.id || 0);
    if (other) fail(409, `That team leader already leads ${other.name}.`);
    v.tl_id = tl;
  }
  if (body.sme_id !== undefined) {
    const sme = Number(body.sme_id) || null;
    if (sme && !get("SELECT id FROM users WHERE id = ? AND role = 'sme' AND status = 'active'", sme)) fail(400, 'Choose an active SME.');
    v.sme_id = sme;
  }
  return v;
}

// Move everything keyed on the old TL's id to the new TL, so the team keeps its feed, schedule and members.
function moveTeamLeader(oldTl, newTl) {
  if (!oldTl || oldTl === newTl) return;
  run('UPDATE users SET team_leader_id = ? WHERE team_leader_id = ?', newTl, oldTl);
  run('UPDATE posts SET team_id = ? WHERE team_id = ?', newTl, oldTl);
  run('UPDATE stories SET team_id = ? WHERE team_id = ?', newTl, oldTl);
  run('UPDATE schedules SET team_id = ? WHERE team_id = ?', newTl, oldTl);
  run('DELETE FROM team_settings WHERE team_id = ?', newTl);
  run('UPDATE team_settings SET team_id = ? WHERE team_id = ?', newTl, oldTl);
  run('DELETE FROM post_permissions WHERE team_id = ?', newTl);
  run('UPDATE post_permissions SET team_id = ? WHERE team_id = ?', newTl, oldTl);
}

r.post('/', h((req, res) => {
  mustOversee(req);
  const v = readTeam(req.body || {});
  const id = tx(() => {
    // A manager who creates a team supervises it unless someone else is chosen.
    const manager = v.manager_id !== undefined ? v.manager_id : (req.user.role === 'manager' ? req.user.id : null);
    const id = Number(run('INSERT INTO teams (name, tl_id, sme_id, manager_id, department, description, color, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      v.name, v.tl_id, v.sme_id ?? null, manager, v.department, v.description ?? '', v.color ?? '#5B8DEF', v.status ?? 'active', req.user.id).lastInsertRowid);
    if (v.sme_id) run('UPDATE users SET team_leader_id = ? WHERE id = ?', v.tl_id, v.sme_id);
    return id;
  });
  notifyLeader(v.tl_id, req.user.id, 'You lead a new team', `${req.user.full_name} made you the team leader of ${v.name}.`);
  if (v.sme_id) notifyMember(v.sme_id, req.user.id, 'New team', `You are now the SME of ${v.name}.`);
  res.status(201).json({ team: teamOut(teamById(id), { detail: true }) });
}));

r.patch('/:id', h((req, res) => {
  mustOversee(req);
  const team = teamById(req.params.id);
  const v = readTeam(req.body || {}, team);
  const tlId = v.tl_id ?? team.tl_id;
  if (v.status === 'archived' && team.status !== 'archived' && membersOf(team).length) {
    fail(409, 'Move this team’s agents and SMEs to another team before archiving it.');
  }
  tx(() => {
    if (v.tl_id && v.tl_id !== team.tl_id) moveTeamLeader(team.tl_id, v.tl_id);
    if (v.sme_id && tlId) run('UPDATE users SET team_leader_id = ? WHERE id = ?', tlId, v.sme_id);
    const keys = Object.keys(v);
    if (keys.length) run(`UPDATE teams SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => v[k]), team.id);
  });
  const name = v.name || team.name;
  if (v.tl_id && v.tl_id !== team.tl_id) {
    notifyLeader(v.tl_id, req.user.id, 'You lead a team', `${req.user.full_name} made you the team leader of ${name}.`);
    notifyLeader(team.tl_id, req.user.id, 'Team leader changed', `You are no longer the team leader of ${name}.`);
  }
  if (v.sme_id && v.sme_id !== team.sme_id) notifyMember(v.sme_id, req.user.id, 'Team assignment', `You are now the SME of ${name}.`);
  if (v.manager_id && v.manager_id !== team.manager_id) notifyMember(v.manager_id, req.user.id, 'Team assignment', `You now supervise ${name}.`);
  res.json({ team: teamOut(teamById(team.id), { detail: true }) });
}));

r.delete('/:id', h((req, res) => {
  if (req.user.role !== 'developer') fail(403, 'Only developers can delete teams.');
  const team = teamById(req.params.id);
  if (membersOf(team).length) fail(409, 'Move this team’s agents and SMEs to another team before deleting it.');
  run('DELETE FROM teams WHERE id = ?', team.id);
  res.json({ ok: true });
}));

// Assign, transfer (or unassign with team_id = null) agents and SMEs, one or many at a time.
r.post('/assign', h((req, res) => {
  mustOversee(req);
  const ids = [...new Set((req.body?.user_ids || []).map(Number).filter(Boolean))].slice(0, 500);
  if (!ids.length) fail(400, 'Select at least one person.');
  const target = req.body?.team_id ? teamById(req.body.team_id) : null;
  if (target && (target.status !== 'active' || !target.tl_id)) fail(400, 'That team is archived or has no team leader.');
  const people = all(`SELECT id, full_name, role, team_leader_id FROM users WHERE id IN (${ph(ids)}) AND role IN ('agent','sme') AND status = 'active'`, ...ids);
  if (people.length !== ids.length) fail(400, 'Only active agents and SMEs can be assigned to a team.');
  const newTl = target?.tl_id ?? null;
  const moved = people.filter((p) => p.team_leader_id !== newTl);
  tx(() => {
    for (const p of moved) {
      run('UPDATE users SET team_leader_id = ? WHERE id = ?', newTl, p.id);
      if (p.role === 'sme') {
        run('UPDATE teams SET sme_id = NULL WHERE sme_id = ? AND (tl_id IS NULL OR tl_id != ?)', p.id, newTl ?? 0);
        if (target && !target.sme_id) run('UPDATE teams SET sme_id = ? WHERE id = ? AND sme_id IS NULL', p.id, target.id);
      }
    }
  });
  // Notify the people moved and both team leaders.
  const fromTeams = new Map();
  for (const p of moved) {
    notifyMember(p.id, req.user.id, target ? 'Team assignment' : 'Removed from team',
      target ? `You are now part of ${target.name}. Your Work tab shows ${target.name}’s workspace.` : 'You are no longer assigned to a team.');
    if (p.team_leader_id) fromTeams.set(p.team_leader_id, (fromTeams.get(p.team_leader_id) || 0) + 1);
  }
  for (const [tl, n] of fromTeams) notifyLeader(tl, req.user.id, 'Team members moved', `${n} member${n > 1 ? 's' : ''} left your team${target ? ` for ${target.name}` : ''}.`);
  if (target && moved.length) notifyLeader(target.tl_id, req.user.id, 'New team members', `${moved.length} member${moved.length > 1 ? 's were' : ' was'} added to ${target.name}.`);
  res.json({ moved: moved.length, team: target ? teamOut(teamById(target.id), { detail: true }) : null });
}));

export default r;
