import { MOODS } from '../../shared/constants.js';
import { all, get, getSetting } from './db.js';
import { localDay, addDays } from './util.js';

export const POSITIVE = ['happy', 'excited', 'energetic', 'chill', 'curious'];
export const LOW_ENERGY = ['tired', 'lazy', 'sleepy'];
export const NEGATIVE = ['sad', 'angry'];

const ph = (arr) => arr.map(() => '?').join(',') || 'NULL';
const dayToDate = (d) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd);
};
export const daysBetween = (from, to) => {
  const out = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
};
const weekStart = (day) => {
  const dt = dayToDate(day);
  const dow = (dt.getDay() + 6) % 7; // Monday = 0
  return localDay(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - dow));
};

export function normalizeRange(q = {}) {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : localDay();
  let from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : addDays(to, -29);
  if (from > to) from = to;
  if (daysBetween(from, to).length > 366) from = addDays(to, -365);
  return { from, to };
}

/** User ids in scope. teamLeaderId null = whole organisation. */
export function scopeUserIds(teamLeaderId = null) {
  if (!teamLeaderId) return all("SELECT id FROM users").map((u) => u.id);
  return all('SELECT id FROM users WHERE id = ? OR team_leader_id = ?', teamLeaderId, teamLeaderId).map((u) => u.id);
}

function countsByMood(rows) {
  const m = Object.fromEntries(MOODS.map((x) => [x.key, 0]));
  rows.forEach((r) => { if (m[r.mood] !== undefined) m[r.mood] += r.c; });
  return m;
}
export function distribution(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return MOODS.map((x) => ({ mood: x.key, label: x.label, emoji: x.emoji, color: x.color, count: counts[x.key] || 0, pct: total ? Math.round(((counts[x.key] || 0) / total) * 1000) / 10 : 0 }));
}

export function moodSeries(ids, from, to, moodFilter = null) {
  const rows = all(
    `SELECT day, mood, COUNT(*) c FROM mood_logs WHERE user_id IN (${ph(ids)}) AND day BETWEEN ? AND ? ${moodFilter ? 'AND mood = ?' : ''} GROUP BY day, mood`,
    ...ids, from, to, ...(moodFilter ? [moodFilter] : [])
  );
  return rows;
}

const bucketize = (rows, keyFn, keys) => {
  const map = new Map(keys.map((k) => [k, Object.fromEntries(MOODS.map((m) => [m.key, 0]))]));
  rows.forEach((r) => {
    const k = keyFn(r.day);
    if (map.has(k) && map.get(k)[r.mood] !== undefined) map.get(k)[r.mood] += r.c;
  });
  return keys.map((k) => {
    const v = map.get(k);
    return { key: k, total: Object.values(v).reduce((a, b) => a + b, 0), ...v };
  });
};

export function statistics({ from, to, teamLeaderId = null, mood = null }) {
  const ids = scopeUserIds(teamLeaderId);
  const windowDays = Number(getSetting('active_window_days')) || 7;
  const activeSince = new Date(Date.now() - windowDays * 864e5).toISOString();
  const users = all(`SELECT id, status, last_active_at FROM users WHERE id IN (${ph(ids)})`, ...ids);
  const totals = {
    registered: users.length,
    active: users.filter((u) => u.status === 'active' && u.last_active_at && u.last_active_at >= activeSince).length,
    disabled: users.filter((u) => u.status !== 'active').length,
    activeWindowDays: windowDays,
  };
  totals.inactive = totals.registered - totals.active;

  const rangeRows = moodSeries(ids, from, to, mood);
  const dist = distribution(countsByMood(rangeRows));
  const totalSelections = dist.reduce((a, b) => a + b.count, 0);
  const picked = dist.filter((d) => d.count > 0).sort((a, b) => b.count - a.count);

  // Daily (selected range), weekly (12 weeks), monthly (12 months) — all ending at `to`.
  const days = daysBetween(from, to);
  const daily = bucketize(rangeRows, (d) => d, days).map((x) => ({ ...x, label: x.key.slice(5) }));
  const wkFrom = addDays(weekStart(to), -7 * 11);
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(wkFrom, 7 * i));
  const weekly = bucketize(moodSeries(ids, wkFrom, to, mood), weekStart, weeks).map((x) => ({ ...x, label: `Wk ${x.key.slice(5)}` }));
  const toD = dayToDate(to);
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(toD.getFullYear(), toD.getMonth() - 11 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const monthly = bucketize(moodSeries(ids, `${months[0]}-01`, to, mood), (d) => d.slice(0, 7), months).map((x) => ({
    ...x, label: new Date(Number(x.key.slice(0, 4)), Number(x.key.slice(5)) - 1, 1).toLocaleString('en', { month: 'short', year: '2-digit' }),
  }));

  // Participation: distinct users logging a mood per day / users in scope.
  const partRows = all(
    `SELECT day, COUNT(DISTINCT user_id) c FROM mood_logs WHERE user_id IN (${ph(ids)}) AND day BETWEEN ? AND ? GROUP BY day`, ...ids, from, to
  );
  const activeCount = users.filter((u) => u.status === 'active').length || 1;
  const partMap = Object.fromEntries(partRows.map((r) => [r.day, r.c]));
  const participation = days.map((d) => ({ day: d, label: d.slice(5), users: partMap[d] || 0, pct: Math.round(((partMap[d] || 0) / activeCount) * 1000) / 10 }));
  const avgParticipation = participation.length ? Math.round((participation.reduce((a, b) => a + b.pct, 0) / participation.length) * 10) / 10 : 0;

  const fromIso = dayToDate(from).toISOString();
  const toIso = new Date(dayToDate(to).getTime() + 864e5).toISOString();
  const cnt = (sql) => get(sql, ...ids, fromIso, toIso).c;
  const engagement = {
    posts: cnt(`SELECT COUNT(*) c FROM posts WHERE team_id IS NULL AND user_id IN (${ph(ids)}) AND created_at >= ? AND created_at < ?`),
    workPosts: cnt(`SELECT COUNT(*) c FROM posts WHERE team_id IS NOT NULL AND user_id IN (${ph(ids)}) AND created_at >= ? AND created_at < ?`),
    comments: cnt(`SELECT COUNT(*) c FROM comments WHERE user_id IN (${ph(ids)}) AND created_at >= ? AND created_at < ?`),
    likes: cnt(`SELECT COUNT(*) c FROM likes WHERE user_id IN (${ph(ids)}) AND created_at >= ? AND created_at < ?`),
    stories: cnt(`SELECT COUNT(*) c FROM stories WHERE user_id IN (${ph(ids)}) AND created_at >= ? AND created_at < ?`),
    locationStories: cnt(`SELECT COUNT(*) c FROM stories WHERE lat IS NOT NULL AND user_id IN (${ph(ids)}) AND created_at >= ? AND created_at < ?`),
    trips: cnt(`SELECT COUNT(*) c FROM trips WHERE user_id IN (${ph(ids)}) AND started_at >= ? AND started_at < ?`),
    highlightLikes: cnt(`SELECT COUNT(*) c FROM highlight_likes WHERE user_id IN (${ph(ids)}) AND created_at >= ? AND created_at < ?`),
    messages: cnt(`SELECT COUNT(*) c FROM messages WHERE kind = 'text' AND sender_id IN (${ph(ids)}) AND created_at >= ? AND created_at < ?`),
    logins: cnt(`SELECT COUNT(*) c FROM login_logs WHERE user_id IN (${ph(ids)}) AND created_at >= ? AND created_at < ?`),
  };
  const loginRows = all(
    `SELECT date(created_at, 'localtime') d, COUNT(*) c FROM login_logs WHERE user_id IN (${ph(ids)}) AND created_at >= ? AND created_at < ? GROUP BY d`,
    ...ids, fromIso, toIso
  );
  const activeRows = all(`SELECT day, COUNT(*) c FROM activity_days WHERE user_id IN (${ph(ids)}) AND day BETWEEN ? AND ? GROUP BY day`, ...ids, from, to);
  const lm = Object.fromEntries(loginRows.map((r) => [r.d, r.c]));
  const am = Object.fromEntries(activeRows.map((r) => [r.day, r.c]));
  const activity = days.map((d) => ({ day: d, label: d.slice(5), logins: lm[d] || 0, activeUsers: am[d] || 0 }));

  const pos = dist.filter((d) => POSITIVE.includes(d.mood)).reduce((a, b) => a + b.count, 0);
  return {
    range: { from, to },
    totals,
    distribution: dist,
    totalSelections,
    mostSelected: picked[0] || null,
    leastSelected: picked.length ? picked[picked.length - 1] : null,
    positiveShare: totalSelections ? Math.round((pos / totalSelections) * 1000) / 10 : 0,
    daily,
    weekly,
    monthly,
    participation,
    avgParticipation,
    engagement,
    activity,
  };
}

/** Team report for one team leader. */
export function teamReport(tlId, { from, to, mood = null, agentId = null, smeId = null }) {
  const tl = get('SELECT id, user_code, full_name, email, avatar, role, job_title, last_active_at, status FROM users WHERE id = ?', tlId);
  if (!tl) return null;
  const members = all(
    `SELECT id, user_code, full_name, email, avatar, role, status, last_active_at, last_login_at, created_at
     FROM users WHERE team_leader_id = ? ORDER BY role, full_name`, tlId
  );
  const fromIso = dayToDate(from).toISOString();
  const toIso = new Date(dayToDate(to).getTime() + 864e5).toISOString();
  const nDays = daysBetween(from, to).length;
  const memberStats = (u) => {
    const moods = all('SELECT mood, COUNT(*) c FROM mood_logs WHERE user_id = ? AND day BETWEEN ? AND ? GROUP BY mood ORDER BY c DESC', u.id, from, to);
    const last = get('SELECT mood, day FROM mood_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1', u.id);
    const moodDays = get('SELECT COUNT(DISTINCT day) c FROM mood_logs WHERE user_id = ? AND day BETWEEN ? AND ?', u.id, from, to).c;
    const attendance = get('SELECT COUNT(*) c FROM activity_days WHERE user_id = ? AND day BETWEEN ? AND ?', u.id, from, to).c;
    const logins = get('SELECT COUNT(*) c FROM login_logs WHERE user_id = ? AND created_at >= ? AND created_at < ?', u.id, fromIso, toIso).c;
    const posts = get('SELECT COUNT(*) c FROM posts WHERE user_id = ? AND created_at >= ? AND created_at < ?', u.id, fromIso, toIso).c;
    const total = moods.reduce((a, b) => a + b.c, 0);
    const pos = moods.filter((m) => POSITIVE.includes(m.mood)).reduce((a, b) => a + b.c, 0);
    return {
      ...u,
      topMood: moods[0]?.mood || null,
      lastMood: last || null,
      moodCounts: Object.fromEntries(moods.map((m) => [m.mood, m.c])),
      moodSelections: total,
      positiveShare: total ? Math.round((pos / total) * 100) : null,
      participationPct: Math.round((moodDays / nDays) * 100),
      attendanceDays: attendance,
      attendancePct: Math.round((attendance / nDays) * 100),
      logins,
      posts,
    };
  };
  let agents = members.filter((m) => m.role === 'agent').map(memberStats);
  const smes = members.filter((m) => m.role === 'sme').map(memberStats);
  if (agentId) agents = agents.filter((a) => a.id === agentId);
  if (mood) agents = agents.filter((a) => a.moodCounts[mood]);
  let focusIds = agentId ? [agentId] : smeId ? [smeId] : [tlId, ...members.map((m) => m.id)];
  if (mood && !agentId && !smeId) focusIds = [tlId, ...members.filter((m) => all('SELECT 1 FROM mood_logs WHERE user_id = ? AND mood = ? AND day BETWEEN ? AND ? LIMIT 1', m.id, mood, from, to).length).map((m) => m.id)];

  const stats = statisticsForIds(focusIds, from, to, mood);
  const scoped = [...agents, ...smes];
  const avg = (k) => (scoped.length ? Math.round(scoped.reduce((a, b) => a + (b[k] || 0), 0) / scoped.length) : 0);
  const withMood = scoped.filter((s) => s.positiveShare !== null);
  return {
    teamLeader: tl,
    agents,
    smes,
    analytics: stats,
    summary: {
      teamSize: members.length,
      agents: members.filter((m) => m.role === 'agent').length,
      smes: members.filter((m) => m.role === 'sme').length,
      avgParticipation: avg('participationPct'),
      avgAttendance: avg('attendancePct'),
      totalLogins: scoped.reduce((a, b) => a + b.logins, 0),
      totalPosts: scoped.reduce((a, b) => a + b.posts, 0),
      wellbeing: withMood.length ? Math.round(withMood.reduce((a, b) => a + b.positiveShare, 0) / withMood.length) : null,
      dominantMood: stats.mostSelected,
      atRisk: scoped.filter((s) => s.moodSelections >= 2 && s.positiveShare !== null && s.positiveShare < 40).map((s) => ({ id: s.id, full_name: s.full_name, positiveShare: s.positiveShare })),
    },
  };
}

function statisticsForIds(ids, from, to, mood) {
  const rows = moodSeries(ids, from, to, mood);
  const dist = distribution(countsByMood(rows));
  const days = daysBetween(from, to);
  const daily = bucketize(rows, (d) => d, days).map((x) => ({ ...x, label: x.key.slice(5) }));
  const att = all(`SELECT day, COUNT(*) c FROM activity_days WHERE user_id IN (${ph(ids)}) AND day BETWEEN ? AND ? GROUP BY day`, ...ids, from, to);
  const am = Object.fromEntries(att.map((r) => [r.day, r.c]));
  const picked = dist.filter((d) => d.count).sort((a, b) => b.count - a.count);
  return {
    distribution: dist,
    daily,
    attendance: days.map((d) => ({ day: d, label: d.slice(5), present: am[d] || 0, absent: Math.max(0, ids.length - (am[d] || 0)) })),
    mostSelected: picked[0] || null,
    leastSelected: picked.at(-1) || null,
  };
}

/** Compact daily summary used for the Daily Report notifications. */
export function dailySummary(day, teamLeaderId = null) {
  const ids = scopeUserIds(teamLeaderId);
  const activeUsers = all(`SELECT id FROM users WHERE status = 'active' AND id IN (${ph(ids)})`, ...ids).length || 1;
  const rows = moodSeries(ids, day, day);
  const dist = distribution(countsByMood(rows)).filter((d) => d.count).sort((a, b) => b.count - a.count);
  const participants = get(`SELECT COUNT(DISTINCT user_id) c FROM mood_logs WHERE day = ? AND user_id IN (${ph(ids)})`, day, ...ids).c;
  const present = get(`SELECT COUNT(*) c FROM activity_days WHERE day = ? AND user_id IN (${ph(ids)})`, day, ...ids).c;
  const prev = moodSeries(ids, addDays(day, -7), addDays(day, -1));
  const prevDist = distribution(countsByMood(prev));
  const prevTotal = prevDist.reduce((a, b) => a + b.count, 0);
  const prevPos = prevTotal ? prevDist.filter((d) => POSITIVE.includes(d.mood)).reduce((a, b) => a + b.count, 0) / prevTotal : null;
  const total = dist.reduce((a, b) => a + b.count, 0);
  const pos = total ? dist.filter((d) => POSITIVE.includes(d.mood)).reduce((a, b) => a + b.count, 0) / total : null;
  const trend = pos === null || prevPos === null ? 'steady' : pos - prevPos > 0.05 ? 'improving' : prevPos - pos > 0.05 ? 'declining' : 'steady';
  return {
    day,
    participationPct: Math.round((participants / activeUsers) * 100),
    participants,
    activeUsers,
    present,
    topMoods: dist.slice(0, 3),
    positivePct: pos === null ? null : Math.round(pos * 100),
    trend,
  };
}
