import { get, all } from './db.js';
import { moodByKey } from '../../shared/constants.js';
import { localDay, addDays, areFriends, isBlocked } from './util.js';

// Who may see someone's mood:
//   Work mood — both people have Work Mode on and share an active team. Shown beside the chat streak,
//               in team channels and the team's Members list, and counted in team mood analytics.
//   Profile mood — friends and work teammates see your current mood on your profile (Chat → profile → mood).
//               It is never shown beside the streak or counted in team analytics.
// With Work Mode off, nothing about your mood is shared with your teams.

/** Latest mood from today or yesterday (check-in, mood story or note), or null. */
export function currentMood(userId) {
  const row = get('SELECT mood, note, source, day, created_at FROM mood_logs WHERE user_id = ? AND day >= ? ORDER BY id DESC LIMIT 1', userId, addDays(localDay(), -1));
  return moodOut(row);
}
export function moodOut(row) {
  const m = row && moodByKey(row.mood);
  return m ? { key: m.key, label: m.label, emoji: m.emoji, note: row.note || null, day: row.day, at: row.created_at } : null;
}

const workModeOn = (id) => !!get('SELECT work_mode FROM users WHERE id = ?', id)?.work_mode;

/** Both have Work Mode on and share at least one active team. */
export function workMoodShared(a, b) {
  if (!a || !b) return false;
  if (a === b) return workModeOn(a);
  if (!workModeOn(a) || !workModeOn(b)) return false;
  return !!get(
    `SELECT 1 x FROM team_members m1 JOIN team_members m2 ON m2.team_id = m1.team_id JOIN teams t ON t.id = m1.team_id
     WHERE m1.user_id = ? AND m2.user_id = ? AND t.status = 'active' LIMIT 1`, a, b
  );
}

/** Mood for the chat streak and team views: only between Work Mode teammates. */
export const workMood = (viewerId, userId) => (workMoodShared(viewerId, userId) ? currentMood(userId) : null);

/** Mood on someone's profile: yourself, your friends, and your Work Mode teammates. */
export function profileMood(viewerId, userId) {
  if (viewerId !== userId && (isBlocked(viewerId, userId) || !(areFriends(viewerId, userId) || workMoodShared(viewerId, userId)))) return null;
  return currentMood(userId);
}

/** Last few moods (one per day, newest first) for team mood history. */
export function moodHistory(userId, days = 7) {
  const rows = all('SELECT mood, note, source, day, created_at, id FROM mood_logs WHERE user_id = ? AND day >= ? ORDER BY id DESC', userId, addDays(localDay(), -(days - 1)));
  const seen = new Set();
  return rows.filter((r) => (seen.has(r.day) ? false : seen.add(r.day))).map(moodOut).filter(Boolean);
}
