import { Router } from 'express';
import { MOODS, moodByKey } from '../../../shared/constants.js';
import { get, all, run, tx } from '../db.js';
import { auth } from '../auth.js';
import { h, fail, imageUpload, fileUrl, publicUser, nowIso, localDay, addDays } from '../util.js';
import { notify } from '../notify.js';
import { hydratePosts, hydratePost } from './posts.js';
import { POSITIVE, LOW_ENERGY, NEGATIVE } from '../analytics.js';
import {
  teamOf, isOverseer, workTeams, teamLeader, canAccessTeam, canManageTeam, canPostInTeam, teamSettings, postPermission, teamMemberIds, resolveTeam, teamName, teamRow,
} from '../teams.js';

const r = Router();
r.use(auth());

export const SCHEDULE_KINDS = ['shift', 'rest', 'lunch', 'meeting', 'overtime', 'coaching', 'training'];
const KIND_LABEL = { shift: 'Shift', rest: 'Rest day', lunch: 'Lunch', meeting: 'Meeting', overtime: 'Overtime', coaching: 'Coaching session', training: 'Training' };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function team(req, source = req.query) {
  const t = resolveTeam(req.user, source?.team);
  if (!t) fail(404, isOverseer(req.user) ? 'You don’t supervise any team yet. Ask a developer to assign teams to you in Team Management.' : 'You are not assigned to a team yet. Ask your manager to add you to one.');
  if (!canAccessTeam(req.user, t)) fail(403, 'You can only see your own team’s workspace.');
  return t;
}
const mustManage = (req, t) => { if (!canManageTeam(req.user, t)) fail(403, 'Only the team leader can do that.'); };
const teamOut = (t) => {
  const tl = teamLeader(t);
  const row = teamRow(t);
  const sme = row?.sme_id ? publicUser(row.sme_id) : null;
  const manager = row?.manager_id ? publicUser(row.manager_id) : null;
  return tl && { id: tl.id, name: teamName(t), color: row?.color || null, department: row?.department || null, leader: publicUser(tl.id), sme, manager, members: teamMemberIds(t).length };
};
const fanout = (teamId, exceptId, payload) => teamMemberIds(teamId).filter((id) => id !== exceptId).forEach((uid) => notify({ ...payload, userId: uid }));

// ---------- context ----------
r.get('/work/context', h((req, res) => {
  const overseer = isOverseer(req.user);
  const t = resolveTeam(req.user, req.query.team);
  if (!t) return res.json({ team: null, teams: overseer ? [] : null, overseer });
  const s = teamSettings(t);
  res.json({
    team: teamOut(t),
    teams: overseer ? workTeams(req.user).map((x) => teamOut(x.id)) : null,
    overseer,
    canManage: canManageTeam(req.user, t),
    canPost: canPostInTeam(req.user, t),
    canSeeMood: canManageTeam(req.user, t) || req.user.role === 'sme',
    settings: { members_can_post: !!s.members_can_post },
    myRequest: postPermission(t, req.user.id) || null,
    pendingRequests: canManageTeam(req.user, t) ? get("SELECT COUNT(*) c FROM post_permissions WHERE team_id = ? AND status = 'pending'", t).c : 0,
  });
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
  if (!canPostInTeam(req.user, t)) fail(403, teamSettings(t).members_can_post ? 'Request posting permission from your team leader first.' : 'Only your team leader can post in the Work feed.');
  const text = String(req.body?.text || '').trim().slice(0, 5000);
  const files = req.files || [];
  if (!text && !files.length) fail(400, 'Write something or add a photo.');
  const kind = req.body?.kind === 'announcement' && (canManageTeam(req.user, t) || req.user.role === 'sme') ? 'announcement' : 'post';
  const pinned = ['1', 'true'].includes(req.body?.pinned) && canManageTeam(req.user, t) ? 1 : 0;
  const id = tx(() => {
    const id = Number(run('INSERT INTO posts (user_id, text, team_id, kind, pinned) VALUES (?, ?, ?, ?, ?)', req.user.id, text, t, kind, pinned).lastInsertRowid);
    files.forEach((f, i) => run('INSERT INTO post_images (post_id, url, position) VALUES (?, ?, ?)', id, fileUrl(f), i));
    return id;
  });
  const tn = teamOut(t).name;
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

// ---------- posting permission ----------
r.patch('/work/settings', h((req, res) => {
  const t = team(req, req.body);
  mustManage(req, t);
  const on = req.body?.members_can_post ? 1 : 0;
  run('INSERT INTO team_settings (team_id, members_can_post) VALUES (?, ?) ON CONFLICT(team_id) DO UPDATE SET members_can_post = excluded.members_can_post', t, on);
  res.json({ members_can_post: !!on });
}));
r.post('/work/permission', h((req, res) => {
  const t = teamOf(req.user);
  if (!t) fail(400, 'You are not assigned to a team.');
  if (canPostInTeam(req.user, t)) fail(400, 'You can already post in the Work feed.');
  if (!teamSettings(t).members_can_post) fail(400, 'Your team leader has not opened the Work feed to member posts yet.');
  const note = String(req.body?.note || '').trim().slice(0, 300);
  run(`INSERT INTO post_permissions (team_id, user_id, status, note, created_at) VALUES (?, ?, 'pending', ?, ?)
       ON CONFLICT(team_id, user_id) DO UPDATE SET status = 'pending', note = excluded.note, created_at = excluded.created_at, decided_at = NULL, decided_by = NULL`, t, req.user.id, note, nowIso());
  const payload = { type: 'post_permission', actorId: req.user.id, entityType: 'team', entityId: t, title: 'Posting permission request', body: `${req.user.full_name} asked to post in the Work feed.${note ? ` “${note}”` : ''}` };
  notify({ ...payload, userId: t });
  notify({ ...payload, userId: t, audience: 'admin' });
  res.json(postPermission(t, req.user.id));
}));
r.get('/work/permissions', h((req, res) => {
  const t = team(req);
  mustManage(req, t);
  res.json(all("SELECT * FROM post_permissions WHERE team_id = ? ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC", t).map((p) => ({ ...p, user: publicUser(p.user_id) })));
}));
r.post('/work/permissions/:userId', h((req, res) => {
  const t = team(req, req.body);
  mustManage(req, t);
  const uid = Number(req.params.userId);
  const decision = { approve: 'approved', reject: 'rejected', revoke: 'rejected' }[req.body?.decision];
  if (!decision) fail(400, 'Choose approve or reject.');
  if (!postPermission(t, uid)) {
    if (!teamMemberIds(t).includes(uid)) fail(404, 'That person is not on this team.');
    run('INSERT INTO post_permissions (team_id, user_id, status) VALUES (?, ?, ?)', t, uid, decision);
  }
  run('UPDATE post_permissions SET status = ?, decided_by = ?, decided_at = ? WHERE team_id = ? AND user_id = ?', decision, req.user.id, nowIso(), t, uid);
  notify({ userId: uid, type: 'post_permission', actorId: req.user.id, entityType: 'team', entityId: t, title: decision === 'approved' ? 'You can now post in the Work feed' : 'Posting permission update',
    body: decision === 'approved' ? `${req.user.full_name} approved your request to post in the Work feed.` : `${req.user.full_name} ${req.body.decision === 'revoke' ? 'turned off' : 'declined'} your Work feed posting permission.` });
  res.json(postPermission(t, uid));
}));

// ---------- members ----------
r.get('/work/members', h((req, res) => {
  const t = team(req);
  const manage = canManageTeam(req.user, t) || req.user.role === 'sme';
  const today = localDay();
  const s = teamSettings(t);
  res.json(teamMemberIds(t).map((id) => {
    const u = publicUser(id);
    const perm = postPermission(t, id);
    const full = get('SELECT last_active_at FROM users WHERE id = ?', id);
    return {
      ...u,
      canPost: u.role === 'tl' || u.role === 'sme' || (!!s.members_can_post && perm?.status === 'approved'),
      permission: perm?.status || null,
      ...(manage ? {
        last_active_at: full.last_active_at,
        mood_today: get('SELECT mood FROM mood_logs WHERE user_id = ? AND day = ? ORDER BY id DESC LIMIT 1', id, today)?.mood || null,
        active_days_7: get('SELECT COUNT(*) c FROM activity_days WHERE user_id = ? AND day > ?', id, addDays(today, -7)).c,
      } : {}),
    };
  }).sort((a, b) => ['tl', 'sme', 'agent'].indexOf(a.role) - ['tl', 'sme', 'agent'].indexOf(b.role) || a.full_name.localeCompare(b.full_name)));
}));

// ---------- schedules ----------
const schedOut = (s) => ({ ...s, user: s.user_id ? publicUser(s.user_id) : null, label: KIND_LABEL[s.kind] });
r.get('/work/schedules', h((req, res) => {
  const t = team(req);
  const from = DAY.test(req.query.from || '') ? req.query.from : addDays(localDay(), -7);
  const to = DAY.test(req.query.to || '') ? req.query.to : addDays(from, 41);
  // Members see team-wide items plus their own; leaders see everyone's (optionally filtered to one person).
  const manage = canManageTeam(req.user, t) || req.user.role === 'sme';
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
    team: teamOut(t), members: ids.length,
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
  if (!(canManageTeam(req.user, t) || req.user.role === 'sme')) fail(403, 'Team mood analytics are for team leaders.');
  res.json(teamMood(t));
}));

export default r;
