import { Router } from 'express';
import { TEAM_ROLE_LABELS, moodByKey } from '../../../shared/constants.js';
import { get, all, run } from '../db.js';
import { auth } from '../auth.js';
import { h, fail, publicUser, friendIds, isBlocked, nowIso, localDay } from '../util.js';
import { notify } from '../notify.js';
import { streakFor, postMessage, memberIds } from './chats.js';
import { storyOut, canSeeStory } from './stories.js';
import { teamRow, memberRole, canAccessTeam, canSchedule, canAnnounce, teamMemberIds } from '../teams.js';
import { currentMood, profileMood, workMoodShared } from '../moods.js';

// Everything around a conversation that isn't a message: who you have in common, shared teams,
// location stories, chat stats, and for team channels the team mood and your next shift.
const r = Router();
r.use(auth());

const member = (cid, uid) => get('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?', cid, uid);
const workModeOn = (id) => !!get('SELECT work_mode FROM users WHERE id = ?', id)?.work_mode;

function stats(cid) {
  return {
    photos: get("SELECT COUNT(*) c FROM messages WHERE conversation_id = ? AND deleted = 0 AND (image IS NOT NULL OR (attachment IS NOT NULL AND attachment LIKE '%\"type\":\"video/%'))", cid).c,
    messages: get("SELECT COUNT(*) c FROM messages WHERE conversation_id = ? AND deleted = 0 AND kind != 'system'", cid).c,
    files: get("SELECT COUNT(*) c FROM messages WHERE conversation_id = ? AND deleted = 0 AND attachment IS NOT NULL AND attachment NOT LIKE '%\"type\":\"video/%'", cid).c,
    links: get("SELECT COUNT(*) c FROM messages WHERE conversation_id = ? AND deleted = 0 AND kind = 'text' AND (text LIKE '%http://%' OR text LIKE '%https://%')", cid).c,
    streak: streakFor(cid),
  };
}

/** Current moods of a team's Work Mode members, as a distribution (for teammates with Work Mode on). */
export function teamMoodNow(teamId) {
  const ids = all("SELECT m.user_id id FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? AND u.status = 'active' AND u.work_mode = 1", teamId).map((x) => x.id);
  const moods = ids.map(currentMood).filter(Boolean);
  const counts = new Map();
  moods.forEach((m) => counts.set(m.key, (counts.get(m.key) || 0) + 1));
  const distribution = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, n]) => {
    const m = moodByKey(key);
    return { mood: key, label: m.label, emoji: m.emoji, count: n, pct: Math.round((n / moods.length) * 100) };
  });
  return { members: ids.length, participants: moods.length, distribution, top: distribution[0] || null };
}

/** Your next shift (and next meeting) on a team. */
function nextShift(teamId, uid) {
  const today = localDay();
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const pick = (kinds) => get(
    `SELECT * FROM schedules WHERE team_id = ? AND (user_id = ? OR user_id IS NULL) AND kind IN (${kinds.map(() => '?').join(',')})
     AND (day > ? OR (day = ? AND (end_time IS NULL OR end_time > ?))) ORDER BY day, start_time LIMIT 1`, teamId, uid, ...kinds, today, today, hhmm);
  return { shift: pick(['shift', 'overtime']) || null, meeting: pick(['meeting', 'coaching', 'training']) || null };
}

r.get('/conversations/:id/context', h((req, res) => {
  const me = req.user.id;
  const conv = get('SELECT * FROM conversations WHERE id = ?', Number(req.params.id));
  if (!conv || !member(conv.id, me)) fail(404, 'Conversation not found.');
  const out = { stats: stats(conv.id) };

  if (conv.team_id) {
    const t = teamRow(conv.team_id);
    out.team = { id: t.id, name: t.name, logo: t.logo, members: teamMemberIds(t.id).length, my_role: memberRole(me, t.id), my_role_label: TEAM_ROLE_LABELS[memberRole(me, t.id)] };
    out.channels = all("SELECT id, name, team_channel FROM conversations WHERE team_id = ? ORDER BY team_channel IS NULL, CASE team_channel WHEN 'general' THEN 1 WHEN 'announcements' THEN 2 WHEN 'schedules' THEN 3 WHEN 'meetings' THEN 4 WHEN 'projects' THEN 5 END, id", t.id);
    out.can = { schedule: canSchedule(me, t.id), announce: canAnnounce(me, t.id) };
    out.schedule = nextShift(t.id, me);
    // Team mood is shared between Work Mode teammates only.
    out.teamMood = workModeOn(me) ? teamMoodNow(t.id) : null;
    return res.json(out);
  }

  if (conv.type === 'direct') {
    const other = memberIds(conv.id).find((id) => id !== me);
    if (!other) return res.json(out);
    const mine = new Set(friendIds(me));
    const mutual = friendIds(other).filter((id) => mine.has(id) && id !== me && !isBlocked(me, id));
    out.mutuals = { count: mutual.length, users: mutual.slice(0, 3).map(publicUser) };
    // Shared teams and the other person's role: only for teams you're both on.
    out.sharedTeams = all(
      `SELECT t.id, t.name, t.logo, m2.role role FROM team_members m1 JOIN team_members m2 ON m2.team_id = m1.team_id JOIN teams t ON t.id = m1.team_id
       WHERE m1.user_id = ? AND m2.user_id = ? AND t.status = 'active' ORDER BY t.name`, me, other
    ).map((t) => ({ ...t, role_label: TEAM_ROLE_LABELS[t.role] }));
    out.workMood = workMoodShared(me, other);
    out.mood = profileMood(me, other);
    // Location stories: their active stories you can see, with a place you're allowed to see.
    const stories = all("SELECT * FROM stories WHERE user_id = ? AND expires_at > ? AND place_name IS NOT NULL AND place_name != '' ORDER BY id", other, nowIso())
      .filter((s) => canSeeStory(s, me)).map((s) => storyOut(s, me)).filter((s) => s.place_name);
    const byPlace = new Map();
    stories.forEach((s) => { const k = s.place_name; if (!byPlace.has(k)) byPlace.set(k, []); byPlace.get(k).push(s); });
    out.locationStories = { user: publicUser(other), places: [...byPlace.entries()].map(([place, list]) => ({ place, count: list.length, stories: list })) };
    // Their active stories (any audience you can see): a ring on their photo in the chat header opens them.
    const visible = all('SELECT * FROM stories WHERE user_id = ? AND expires_at > ? ORDER BY id', other, nowIso()).filter((s) => canSeeStory(s, me)).map((s) => storyOut(s, me));
    out.stories = visible.length ? { user: publicUser(other), stories: visible, allSeen: visible.every((s) => s.seen) } : null;
    return res.json(out);
  }
  out.members = memberIds(conv.id).length;
  res.json(out);
}));

// Team chat summaries for Chats → Teams: members, team streak (best channel streak) and current team mood.
r.get('/work/chat-teams', h((req, res) => {
  const me = req.user.id;
  const teams = all("SELECT t.* FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? AND t.status = 'active' ORDER BY t.name COLLATE NOCASE", me);
  res.json(teams.map((t) => {
    const channels = all('SELECT id FROM conversations WHERE team_id = ?', t.id).map((c) => c.id);
    return {
      id: t.id, name: t.name, logo: t.logo, members: teamMemberIds(t.id).length,
      streak: Math.max(0, ...channels.map(streakFor)),
      mood: workModeOn(me) ? teamMoodNow(t.id).top : null,
    };
  }));
}));

// Connection servers for calls: public STUN, plus your own TURN server when TURN_URL is set
// (needed when people are behind strict networks).
r.get('/calls/ice', h((_req, res) => {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) servers.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '' });
  res.json({ iceServers: servers });
}));

// Reminder (managers, team leaders and SMEs): posted in a team channel and sent to every member.
r.post('/work/reminders', h((req, res) => {
  const me = req.user;
  const b = req.body || {};
  const conv = get('SELECT * FROM conversations WHERE id = ? AND team_id IS NOT NULL', Number(b.conversationId));
  if (!conv || !canAccessTeam(me, conv.team_id)) fail(404, 'Team channel not found.');
  if (!canSchedule(me, conv.team_id)) fail(403, 'Only managers, team leaders and SMEs send reminders.');
  const text = String(b.text || '').trim().slice(0, 300);
  if (!text) fail(400, 'Write the reminder.');
  const when = b.at && !Number.isNaN(Date.parse(b.at)) ? new Date(b.at) : null;
  const whenLabel = when ? ` · ${when.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : '';
  postMessage({ conversationId: conv.id, sender: me, text: `⏰ Reminder from ${me.full_name}: ${text}${whenLabel}`, kind: 'system' });
  const t = teamRow(conv.team_id);
  teamMemberIds(t.id).filter((id) => id !== me.id).forEach((uid) => notify({ userId: uid, type: 'team', actorId: me.id, entityType: 'team', entityId: t.id, title: `⏰ ${t.name} reminder`, body: `${text}${whenLabel}` }));
  run('UPDATE conversations SET updated_at = ? WHERE id = ?', nowIso(), conv.id);
  res.status(201).json({ ok: true });
}));

export default r;
