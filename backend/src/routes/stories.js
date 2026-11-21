import { Router } from 'express';
import { MOOD_KEYS, THEMES, wordCount, moodByKey } from '../../../shared/constants.js';
import { get, all, run, tx, getSetting, userSettings } from '../db.js';
import { auth } from '../auth.js';
import { h, fail, imageUpload, fileUrl, publicUser, friendIds, areFriends, nowIso, hoursFromNow, localDay, blockedIds, canViewProfile, isBlocked } from '../util.js';
import { postMessage } from './chats.js';
import { notify } from '../notify.js';
import { teamOf, teamMemberIds, teamLeader } from '../teams.js';

const r = Router();
r.use(auth());

const THEME_KEYS = THEMES.map((t) => t.key);
export const logMood = (userId, mood, source) => run('INSERT INTO mood_logs (user_id, mood, source, day) VALUES (?, ?, ?, ?)', userId, mood, source, localDay());

// ---------- Mood Story (24h) ----------
// ---------- story audiences ----------
export const AUDIENCES = ['public', 'friends', 'close_friends', 'team', 'private'];
const viewerTeam = (uid) => teamOf(get('SELECT id, role, team_leader_id FROM users WHERE id = ?', uid));
export function canSeeStory(s, me) {
  if (s.user_id === me) return true;
  if (isBlocked(me, s.user_id)) return false;
  switch (s.audience) {
    case 'private': return false;
    case 'close_friends': return areFriends(me, s.user_id) && !!get('SELECT 1 x FROM close_friends WHERE user_id = ? AND friend_id = ?', s.user_id, me);
    case 'team': return !!s.team_id && viewerTeam(me) === s.team_id;
    default: return areFriends(me, s.user_id); // public + friends: shown to friends (public ones can also be discovered on the map)
  }
}
const parse = (v, fb) => { try { return JSON.parse(v); } catch { return fb; } };

// Location privacy: a story's place is only shown to others when its owner shares location with friends.
export const sharesLocation = (uid) => userSettings(uid).location_sharing === 'friends';
export const storyOut = (s, viewerId) => ({
  ...s,
  ...(s.user_id !== viewerId && !sharesLocation(s.user_id) ? { place_name: null, lat: null, lng: null } : {}),
  seen: !!get('SELECT 1 x FROM story_views WHERE story_id = ? AND user_id = ?', s.id, viewerId),
  my_reaction: get('SELECT reaction FROM story_views WHERE story_id = ? AND user_id = ?', s.id, viewerId)?.reaction || null,
  view_count: s.user_id === viewerId ? get('SELECT COUNT(*) c FROM story_views WHERE story_id = ?', s.id).c : undefined,
  like_count: s.user_id === viewerId ? get("SELECT COUNT(*) c FROM story_views WHERE story_id = ? AND reaction IS NOT NULL", s.id).c : undefined,
  comment_count: s.allow_comments ? get('SELECT COUNT(*) c FROM story_comments WHERE story_id = ?', s.id).c : 0,
  music: null, // music was removed; older stories keep the column but it is never shown
  stickers: parse(s.stickers, []).map((st) => (st.type === 'poll' ? {
    ...st,
    counts: st.options.map((_, i) => get('SELECT COUNT(*) c FROM story_poll_votes WHERE story_id = ? AND option = ?', s.id, i).c),
    my_vote: get('SELECT option FROM story_poll_votes WHERE story_id = ? AND user_id = ?', s.id, viewerId)?.option ?? null,
  } : st)),
  team_name: s.team_id ? `Team ${teamLeader(s.team_id)?.full_name.split(' ')[0] || ''}` : null,
});

r.get('/stories', h((req, res) => {
  const me = req.user.id;
  const hidden = new Set(blockedIds(me));
  const t = viewerTeam(me);
  const ids = [...new Set([me, ...friendIds(me), ...(t ? teamMemberIds(t) : [])])].filter((id) => !hidden.has(id));
  const ph = ids.map(() => '?').join(',');
  const rows = all(`SELECT * FROM stories WHERE user_id IN (${ph}) AND expires_at > ? ORDER BY id`, ...ids, nowIso()).filter((x) => canSeeStory(x, me));
  const byUser = new Map();
  for (const s of rows) {
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, { user: publicUser(s.user_id), stories: [] });
    byUser.get(s.user_id).stories.push(storyOut(s, me));
  }
  const groups = [...byUser.values()].map((g) => ({ ...g, allSeen: g.stories.every((s) => s.seen) }));
  groups.sort((a, b) => (a.user.id === me ? -1 : b.user.id === me ? 1 : a.allSeen - b.allSeen || b.stories.at(-1).id - a.stories.at(-1).id));
  res.json(groups);
}));

const flag = (v, dflt) => (v === undefined || v === '' ? dflt : ['1', 'true', true, 1].includes(v) ? 1 : 0);
const LINK = /^https?:\/\/[^\s]{3,300}$/i;

function readStickers(raw, audience, me) {
  const list = parse(raw || '[]', []);
  if (!Array.isArray(list) || list.length > 6) fail(400, 'Too many stickers.');
  const clip = (v, n) => String(v || '').trim().slice(0, n);
  return list.map((st) => {
    const pos = { x: Math.max(0, Math.min(1, Number(st.pos?.x ?? 0.5))), y: Math.max(0, Math.min(1, Number(st.pos?.y ?? 0.6))) };
    switch (st.type) {
      case 'poll': {
        const options = (st.options || []).map((o) => clip(o, 25)).filter(Boolean).slice(0, 4);
        if (!clip(st.question, 80) || options.length < 2) fail(400, 'A poll needs a question and two options.');
        return { type: 'poll', question: clip(st.question, 80), options, pos };
      }
      case 'question': if (!clip(st.prompt, 80)) fail(400, 'Write a question.'); return { type: 'question', prompt: clip(st.prompt, 80), pos };
      case 'countdown': {
        const ends = new Date(st.ends_at);
        if (!clip(st.title, 40) || Number.isNaN(+ends)) fail(400, 'A countdown needs a title and a date.');
        return { type: 'countdown', title: clip(st.title, 40), ends_at: ends.toISOString(), pos };
      }
      case 'link': if (!LINK.test(String(st.url || ''))) fail(400, 'Links must start with http:// or https://'); return { type: 'link', url: String(st.url), label: clip(st.label, 40) || new URL(st.url).hostname, pos };
      case 'mention': {
        const u = publicUser(Number(st.user_id));
        if (!u || !areFriends(me, u.id) || u.id === me) fail(400, 'You can only mention friends.');
        return { type: 'mention', user_id: u.id, name: u.full_name, pos };
      }
      case 'hashtag': { const tag = clip(st.tag, 30).replace(/[^\p{L}\p{N}_]/gu, ''); if (!tag) fail(400, 'Empty hashtag.'); return { type: 'hashtag', tag, pos }; }
      case 'announcement': if (audience !== 'team') fail(400, 'Work announcements are for Team-only stories.'); return { type: 'announcement', pos };
      default: fail(400, 'Unknown sticker.');
    }
    return null;
  });
}

r.post('/stories', imageUpload.single('image'), h((req, res) => {
  const b = req.body || {};
  const text = String(b.text || '').trim().slice(0, 500);
  const mood = b.mood || null;
  const theme = THEME_KEYS.includes(b.theme) ? b.theme : 'midnight';
  if (mood && !MOOD_KEYS.includes(mood)) fail(400, 'Unknown mood.');
  const audience = AUDIENCES.includes(b.audience) ? b.audience : 'friends';
  const teamId = audience === 'team' ? teamOf(req.user) : null;
  if (audience === 'team' && !teamId) fail(400, 'You are not on a team yet, so you can’t post a Team-only story.');
  const stickers = readStickers(b.stickers, audience, req.user.id);
  if (!text && !req.file && !mood && !stickers.length) fail(400, 'Add a photo, text or a mood.');
  // Optional location tag (📍 Cebu City). Coordinates are validated; the name is free text from the place search.
  const lat = Number(b.lat), lng = Number(b.lng);
  const hasLoc = b.lat !== undefined && b.lat !== '' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const place = hasLoc ? String(b.place_name || '').trim().slice(0, 120) || 'Pinned location' : null;
  const hours = [6, 12, 24].includes(Number(b.duration_hours)) ? Number(b.duration_hours) : Number(getSetting('story_hours')) || 24;
  const id = Number(run(`INSERT INTO stories (user_id, text, image, mood, theme, allow_comments, place_name, lat, lng, expires_at,
      audience, team_id, allow_replies, allow_reactions, allow_sharing, show_on_map, archive, stickers)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  req.user.id, text, fileUrl(req.file), mood, theme, flag(b.allow_comments, 0), place, hasLoc ? lat : null, hasLoc ? lng : null, hoursFromNow(hours),
  audience, teamId, flag(b.allow_replies, 1), flag(b.allow_reactions, 1), flag(b.allow_sharing, 1), hasLoc ? flag(b.show_on_map, 1) : 0, flag(b.archive, 1),
  JSON.stringify(stickers)).lastInsertRowid);
  if (mood) logMood(req.user.id, mood, 'story');
  const created = get('SELECT * FROM stories WHERE id = ?', id);
  stickers.filter((st) => st.type === 'mention').forEach((st) => canSeeStory(created, st.user_id) && notify({ userId: st.user_id, type: 'story_reaction', actorId: req.user.id, entityType: 'story', entityId: id, title: 'Mentioned in a story', body: `${req.user.full_name} mentioned you in their Mood Story.` }));
  res.status(201).json(storyOut(created, req.user.id));
}));

const visibleStory = (id, me) => {
  const s = get('SELECT * FROM stories WHERE id = ?', Number(id));
  if (!s) fail(404, 'Story not found.');
  const inHighlight = get('SELECT 1 x FROM highlight_items WHERE story_id = ?', s.id);
  if (!inHighlight && !canSeeStory(s, me)) fail(403, 'Not visible.');
  if (inHighlight && s.user_id !== me && !canViewProfile(me, get('SELECT id, privacy FROM users WHERE id = ?', s.user_id))) fail(403, 'Not visible.');
  if (s.user_id !== me && s.expires_at < nowIso() && !inHighlight) fail(410, 'This story has expired.');
  return s;
};

r.post('/stories/:id/view', h((req, res) => {
  const s = visibleStory(req.params.id, req.user.id);
  if (s.user_id !== req.user.id) run('INSERT OR IGNORE INTO story_views (story_id, user_id) VALUES (?, ?)', s.id, req.user.id);
  res.json({ ok: true });
}));

r.post('/stories/:id/react', h((req, res) => {
  const s = visibleStory(req.params.id, req.user.id);
  if (s.user_id === req.user.id) fail(400, "You can't react to your own story.");
  if (!s.allow_reactions) fail(403, 'Reactions are turned off for this story.');
  const emoji = String(req.body?.emoji || '❤️').slice(0, 8);
  run(`INSERT INTO story_views (story_id, user_id, reaction) VALUES (?, ?, ?)
       ON CONFLICT(story_id, user_id) DO UPDATE SET reaction = excluded.reaction`, s.id, req.user.id, emoji);
  notify({ userId: s.user_id, type: 'story_reaction', actorId: req.user.id, entityType: 'story', entityId: s.id, title: 'Story reaction', body: `${req.user.full_name} reacted ${emoji} to your Mood Story.` });
  res.json({ reaction: emoji });
}));

// Remove your like/reaction.
r.delete('/stories/:id/react', h((req, res) => {
  run('UPDATE story_views SET reaction = NULL WHERE story_id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  res.json({ reaction: null });
}));

// "Reply to story…" — delivered privately into your direct chat with the owner.
r.post('/stories/:id/reply', h((req, res) => {
  const s = visibleStory(req.params.id, req.user.id);
  if (s.user_id === req.user.id) fail(400, "You can't reply to your own story.");
  if (!s.allow_replies) fail(403, 'Replies are turned off for this story.');
  const text = String(req.body?.text || '').trim().slice(0, 1000);
  if (!text) fail(400, 'Write a reply.');
  const key = [req.user.id, s.user_id].sort((a, b) => a - b).join(':');
  let conv = get('SELECT * FROM conversations WHERE direct_key = ?', key);
  if (!conv) {
    const cid = Number(run("INSERT INTO conversations (type, direct_key, created_by) VALUES ('direct', ?, ?)", key, req.user.id).lastInsertRowid);
    run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', cid, req.user.id);
    run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', cid, s.user_id);
    conv = { id: cid };
  }
  postMessage({ conversationId: conv.id, sender: req.user, text, storyId: s.id });
  res.json({ conversationId: conv.id });
}));

// Optional public story comments (the owner enables them per story).
r.get('/stories/:id/comments', h((req, res) => {
  const s = visibleStory(req.params.id, req.user.id);
  if (!s.allow_comments) return res.json([]);
  res.json(all('SELECT * FROM story_comments WHERE story_id = ? ORDER BY id', s.id).map((c) => ({ ...c, author: publicUser(c.user_id) })));
}));
r.post('/stories/:id/comments', h((req, res) => {
  const s = visibleStory(req.params.id, req.user.id);
  if (!s.allow_comments) fail(403, 'Comments are turned off for this story.');
  const text = String(req.body?.text || '').trim().slice(0, 500);
  if (!text) fail(400, 'Write a comment.');
  const id = Number(run('INSERT INTO story_comments (story_id, user_id, text) VALUES (?, ?, ?)', s.id, req.user.id, text).lastInsertRowid);
  notify({ userId: s.user_id, type: 'story_comment', actorId: req.user.id, entityType: 'story', entityId: s.id, title: 'Story comment', body: `${req.user.full_name} commented on your Mood Story: ${text.slice(0, 80)}` });
  res.status(201).json({ ...get('SELECT * FROM story_comments WHERE id = ?', id), author: publicUser(req.user.id) });
}));
r.patch('/stories/:id', h((req, res) => {
  const s = get('SELECT * FROM stories WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!s) fail(404, 'Story not found.');
  if (req.body?.allow_comments !== undefined) run('UPDATE stories SET allow_comments = ? WHERE id = ?', req.body.allow_comments ? 1 : 0, s.id);
  res.json(storyOut(get('SELECT * FROM stories WHERE id = ?', s.id), req.user.id));
}));

r.get('/stories/:id/viewers', h((req, res) => {
  const s = get('SELECT * FROM stories WHERE id = ?', Number(req.params.id));
  if (!s || s.user_id !== req.user.id) fail(404, 'Story not found.');
  res.json(all('SELECT user_id, reaction, created_at FROM story_views WHERE story_id = ? ORDER BY created_at DESC', s.id)
    .map((v) => ({ ...v, user: publicUser(v.user_id) })));
}));

r.delete('/stories/:id', h((req, res) => {
  const s = get('SELECT * FROM stories WHERE id = ?', Number(req.params.id));
  if (!s || s.user_id !== req.user.id) fail(404, 'Story not found.');
  run('DELETE FROM stories WHERE id = ?', s.id);
  res.json({ ok: true });
}));

// Highlight history / story archive (own stories, including expired ones).
r.get('/stories/archive', h((req, res) => {
  // Stories posted with "Save to archive" off disappear once they expire.
  res.json(all('SELECT * FROM stories WHERE user_id = ? AND (archive = 1 OR expires_at > ?) ORDER BY id DESC LIMIT 300', req.user.id, nowIso()).map((s) => storyOut(s, req.user.id)));
}));

// ---------- interactive stickers ----------
r.post('/stories/:id/poll', h((req, res) => {
  const s = visibleStory(req.params.id, req.user.id);
  const poll = parse(s.stickers, []).find((x) => x.type === 'poll');
  const option = Number(req.body?.option);
  if (!poll || !Number.isInteger(option) || option < 0 || option >= poll.options.length) fail(400, 'Choose an option.');
  run('INSERT INTO story_poll_votes (story_id, user_id, option) VALUES (?, ?, ?) ON CONFLICT(story_id, user_id) DO UPDATE SET option = excluded.option', s.id, req.user.id, option);
  res.json(storyOut(s, req.user.id).stickers.find((x) => x.type === 'poll'));
}));
r.post('/stories/:id/answer', h((req, res) => {
  const s = visibleStory(req.params.id, req.user.id);
  const q = parse(s.stickers, []).find((x) => x.type === 'question');
  const text = String(req.body?.text || '').trim().slice(0, 500);
  if (!q || !text) fail(400, 'Write an answer.');
  if (s.user_id === req.user.id) fail(400, "You can't answer your own question.");
  const key = [req.user.id, s.user_id].sort((x, y) => x - y).join(':');
  let conv = get('SELECT * FROM conversations WHERE direct_key = ?', key);
  if (!conv) {
    const cid = Number(run("INSERT INTO conversations (type, direct_key, created_by) VALUES ('direct', ?, ?)", key, req.user.id).lastInsertRowid);
    run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', cid, req.user.id);
    run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', cid, s.user_id);
    conv = { id: cid };
  }
  postMessage({ conversationId: conv.id, sender: req.user, text: `💬 ${q.prompt}\n${text}`, storyId: s.id });
  res.json({ ok: true });
}));
r.post('/stories/:id/share', h((req, res) => {
  const s = visibleStory(req.params.id, req.user.id);
  if (!s.allow_sharing && s.user_id !== req.user.id) fail(403, 'Sharing is turned off for this story.');
  const ids = (req.body?.conversationIds || []).map(Number).filter(Boolean);
  if (!ids.length) fail(400, 'Choose at least one chat.');
  ids.forEach((cid) => postMessage({ conversationId: cid, sender: req.user, text: String(req.body?.text || '').slice(0, 1000) || 'Shared a story', storyId: s.id }));
  res.json({ ok: true, sent: ids.length });
}));

// ---------- close friends ----------
r.get('/close-friends', h((req, res) => res.json(all('SELECT friend_id FROM close_friends WHERE user_id = ?', req.user.id).map((x) => x.friend_id))));
r.put('/close-friends', h((req, res) => {
  const ids = [...new Set((req.body?.ids || []).map(Number))].filter((id) => areFriends(req.user.id, id) && id !== req.user.id);
  tx(() => {
    run('DELETE FROM close_friends WHERE user_id = ?', req.user.id);
    ids.forEach((id) => run('INSERT INTO close_friends (user_id, friend_id) VALUES (?, ?)', req.user.id, id));
  });
  res.json(ids);
}));

// ---------- Highlights ----------
export const HIGHLIGHT_MAX = 50;
const highlightOut = (hl, viewerId) => {
  const stories = all(
    `SELECT s.* FROM highlight_items i JOIN stories s ON s.id = i.story_id WHERE i.highlight_id = ? ORDER BY s.id`, hl.id
  ).map((s) => storyOut(s, viewerId));
  const mine = hl.user_id === viewerId;
  return {
    ...hl,
    stories,
    cover: hl.cover_image || (hl.cover_emoji ? null : stories.find((s) => s.image)?.image || null),
    coverTheme: stories[0]?.theme,
    coverMood: stories[0]?.mood,
    likes: get('SELECT COUNT(*) c FROM highlight_likes WHERE highlight_id = ?', hl.id).c,
    liked: !!get('SELECT 1 x FROM highlight_likes WHERE highlight_id = ? AND user_id = ?', hl.id, viewerId),
    comments: get('SELECT COUNT(*) c FROM highlight_comments WHERE highlight_id = ?', hl.id).c,
    shares: mine ? hl.shares : undefined,
  };
};
// Anyone who can see the owner's profile can open their highlights.
const visibleHighlight = (id, viewerId) => {
  const hl = get('SELECT * FROM highlights WHERE id = ?', Number(id));
  if (!hl) fail(404, 'Highlight not found.');
  if (!canViewProfile(viewerId, get('SELECT id, privacy FROM users WHERE id = ?', hl.user_id))) fail(403, 'Not visible.');
  return hl;
};
const ownHighlight = (id, uid) => {
  const hl = get('SELECT * FROM highlights WHERE id = ? AND user_id = ?', Number(id), uid);
  if (!hl) fail(404, 'Highlight not found.');
  return hl;
};
const itemCount = (hid) => get('SELECT COUNT(*) c FROM highlight_items WHERE highlight_id = ?', hid).c;

r.get('/users/:id/highlights', h((req, res) => {
  const uid = Number(req.params.id);
  const u = get('SELECT id, privacy FROM users WHERE id = ?', uid);
  if (!u) fail(404, 'User not found.');
  if (!canViewProfile(req.user.id, u)) return res.json([]);
  res.json(all('SELECT * FROM highlights WHERE user_id = ? ORDER BY id DESC', uid).map((x) => highlightOut(x, req.user.id)));
}));
r.get('/highlights/:id', h((req, res) => res.json(highlightOut(visibleHighlight(req.params.id, req.user.id), req.user.id))));

r.post('/highlights', h((req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 40);
  const storyIds = [...new Set((req.body?.storyIds || []).map(Number))];
  const emoji = String(req.body?.cover_emoji || '').slice(0, 8) || null;
  if (!title) fail(400, 'Give your highlight a name.');
  if (!storyIds.length) fail(400, 'Choose at least one story.');
  if (storyIds.length > HIGHLIGHT_MAX) fail(400, `A highlight can hold up to ${HIGHLIGHT_MAX} stories.`);
  const id = tx(() => {
    const id = Number(run('INSERT INTO highlights (user_id, title, cover_emoji) VALUES (?, ?, ?)', req.user.id, title, emoji).lastInsertRowid);
    for (const sid of storyIds) {
      if (get('SELECT 1 x FROM stories WHERE id = ? AND user_id = ?', sid, req.user.id)) run('INSERT OR IGNORE INTO highlight_items (highlight_id, story_id) VALUES (?, ?)', id, sid);
    }
    return id;
  });
  res.status(201).json(highlightOut(get('SELECT * FROM highlights WHERE id = ?', id), req.user.id));
}));

r.patch('/highlights/:id', h((req, res) => {
  const hl = ownHighlight(req.params.id, req.user.id);
  const { title, addStoryIds = [], removeStoryIds = [], cover_emoji, cover_story_id, clear_cover } = req.body || {};
  tx(() => {
    if (title !== undefined && String(title).trim()) run('UPDATE highlights SET title = ? WHERE id = ?', String(title).trim().slice(0, 40), hl.id);
    for (const sid of removeStoryIds.map(Number)) run('DELETE FROM highlight_items WHERE highlight_id = ? AND story_id = ?', hl.id, sid);
    const add = addStoryIds.map(Number).filter((sid) => !get('SELECT 1 x FROM highlight_items WHERE highlight_id = ? AND story_id = ?', hl.id, sid));
    if (itemCount(hl.id) + add.length > HIGHLIGHT_MAX) fail(400, `"${hl.title}" is full. Highlights hold up to ${HIGHLIGHT_MAX} stories.`);
    for (const sid of add) {
      if (get('SELECT 1 x FROM stories WHERE id = ? AND user_id = ?', sid, req.user.id)) run('INSERT OR IGNORE INTO highlight_items (highlight_id, story_id) VALUES (?, ?)', hl.id, sid);
    }
    // Cover: an emoji, one of the highlight's own story photos, or (via /cover) an uploaded image.
    if (cover_emoji !== undefined) run('UPDATE highlights SET cover_emoji = ?, cover_image = NULL WHERE id = ?', String(cover_emoji || '').slice(0, 8) || null, hl.id);
    if (cover_story_id) {
      const st = get('SELECT s.image FROM highlight_items i JOIN stories s ON s.id = i.story_id WHERE i.highlight_id = ? AND s.id = ?', hl.id, Number(cover_story_id));
      if (!st?.image) fail(400, 'Pick a story with a photo for the cover.');
      run('UPDATE highlights SET cover_image = ?, cover_emoji = NULL WHERE id = ?', st.image, hl.id);
    }
    if (clear_cover) run('UPDATE highlights SET cover_image = NULL, cover_emoji = NULL WHERE id = ?', hl.id);
  });
  if (!itemCount(hl.id)) {
    run('DELETE FROM highlights WHERE id = ?', hl.id);
    return res.json({ deleted: true });
  }
  res.json(highlightOut(get('SELECT * FROM highlights WHERE id = ?', hl.id), req.user.id));
}));

r.post('/highlights/:id/cover', imageUpload.single('cover'), h((req, res) => {
  const hl = ownHighlight(req.params.id, req.user.id);
  if (!req.file) fail(400, 'Choose an image.');
  run('UPDATE highlights SET cover_image = ?, cover_emoji = NULL WHERE id = ?', fileUrl(req.file), hl.id);
  res.json(highlightOut(get('SELECT * FROM highlights WHERE id = ?', hl.id), req.user.id));
}));

r.delete('/highlights/:id', h((req, res) => {
  const hl = ownHighlight(req.params.id, req.user.id);
  run('DELETE FROM highlights WHERE id = ?', hl.id);
  res.json({ ok: true });
}));

// Engagement: views, likes, comments and shares.
r.post('/highlights/:id/view', h((req, res) => {
  const hl = visibleHighlight(req.params.id, req.user.id);
  if (hl.user_id !== req.user.id) {
    run(`INSERT INTO highlight_views (highlight_id, user_id) VALUES (?, ?)
         ON CONFLICT(highlight_id, user_id) DO UPDATE SET views = views + 1, last_viewed_at = excluded.last_viewed_at`, hl.id, req.user.id);
  }
  res.json({ ok: true });
}));
r.post('/highlights/:id/like', h((req, res) => {
  const hl = visibleHighlight(req.params.id, req.user.id);
  const had = get('SELECT 1 x FROM highlight_likes WHERE highlight_id = ? AND user_id = ?', hl.id, req.user.id);
  if (had) run('DELETE FROM highlight_likes WHERE highlight_id = ? AND user_id = ?', hl.id, req.user.id);
  else {
    run('INSERT INTO highlight_likes (highlight_id, user_id) VALUES (?, ?)', hl.id, req.user.id);
    notify({ userId: hl.user_id, type: 'like', actorId: req.user.id, entityType: 'highlight', entityId: hl.id, title: 'Highlight liked', body: `${req.user.full_name} liked your highlight "${hl.title}".` });
  }
  res.json({ liked: !had, likes: get('SELECT COUNT(*) c FROM highlight_likes WHERE highlight_id = ?', hl.id).c });
}));
r.get('/highlights/:id/comments', h((req, res) => {
  const hl = visibleHighlight(req.params.id, req.user.id);
  const hidden = new Set(blockedIds(req.user.id));
  res.json(all('SELECT * FROM highlight_comments WHERE highlight_id = ? ORDER BY id', hl.id).filter((c) => !hidden.has(c.user_id)).map((c) => ({ ...c, author: publicUser(c.user_id) })));
}));
r.post('/highlights/:id/comments', h((req, res) => {
  const hl = visibleHighlight(req.params.id, req.user.id);
  const text = String(req.body?.text || '').trim().slice(0, 500);
  if (!text) fail(400, 'Write a comment.');
  const id = Number(run('INSERT INTO highlight_comments (highlight_id, user_id, text) VALUES (?, ?, ?)', hl.id, req.user.id, text).lastInsertRowid);
  notify({ userId: hl.user_id, type: 'comment', actorId: req.user.id, entityType: 'highlight', entityId: hl.id, title: 'Highlight comment', body: `${req.user.full_name} commented on "${hl.title}": ${text.slice(0, 80)}` });
  res.status(201).json({ ...get('SELECT * FROM highlight_comments WHERE id = ?', id), author: publicUser(req.user.id) });
}));
r.delete('/highlights/:hid/comments/:id', h((req, res) => {
  const c = get('SELECT c.*, hl.user_id owner FROM highlight_comments c JOIN highlights hl ON hl.id = c.highlight_id WHERE c.id = ?', Number(req.params.id));
  if (!c || (c.user_id !== req.user.id && c.owner !== req.user.id)) fail(404, 'Comment not found.');
  run('DELETE FROM highlight_comments WHERE id = ?', c.id);
  res.json({ ok: true });
}));
r.post('/highlights/:id/share', h((req, res) => {
  const hl = visibleHighlight(req.params.id, req.user.id);
  const ids = (req.body?.conversationIds || []).map(Number).filter(Boolean);
  if (!ids.length) fail(400, 'Choose at least one chat.');
  ids.forEach((cid) => postMessage({ conversationId: cid, sender: req.user, text: String(req.body?.text || '').slice(0, 1000), highlightId: hl.id }));
  run('UPDATE highlights SET shares = shares + ? WHERE id = ?', ids.length, hl.id);
  res.json({ ok: true, sent: ids.length });
}));
// Owner-only statistics.
r.get('/highlights/:id/stats', h((req, res) => {
  const hl = ownHighlight(req.params.id, req.user.id);
  const v = get('SELECT COUNT(*) viewers, COALESCE(SUM(views), 0) views FROM highlight_views WHERE highlight_id = ?', hl.id);
  res.json({
    views: v.views, viewers: v.viewers, shares: hl.shares,
    likes: get('SELECT COUNT(*) c FROM highlight_likes WHERE highlight_id = ?', hl.id).c,
    comments: get('SELECT COUNT(*) c FROM highlight_comments WHERE highlight_id = ?', hl.id).c,
    stories: itemCount(hl.id), max: HIGHLIGHT_MAX,
    recentViewers: all('SELECT user_id, views, last_viewed_at FROM highlight_views WHERE highlight_id = ? ORDER BY last_viewed_at DESC LIMIT 30', hl.id).map((x) => ({ ...x, user: publicUser(x.user_id) })),
    likers: all('SELECT user_id FROM highlight_likes WHERE highlight_id = ? ORDER BY created_at DESC LIMIT 30', hl.id).map((x) => publicUser(x.user_id)),
  });
}));

// ---------- Notes (above the chat list) ----------
// A note = short text + optional mood + optional emoji sticker + optional bubble colour.
const HEX = /^#[0-9a-f]{6}$/i;
const noteOut = (n, viewerId) => {
  const mine = n.user_id === viewerId;
  return {
    ...n,
    user: publicUser(n.user_id),
    moodInfo: n.mood ? moodByKey(n.mood) : null,
    liked: !!get('SELECT 1 x FROM note_likes WHERE note_id = ? AND user_id = ?', n.id, viewerId),
    like_count: mine ? get('SELECT COUNT(*) c FROM note_likes WHERE note_id = ?', n.id).c : undefined,
    likers: mine ? all('SELECT user_id FROM note_likes WHERE note_id = ? ORDER BY created_at DESC LIMIT 20', n.id).map((x) => publicUser(x.user_id)) : undefined,
  };
};
const visibleNote = (id, me) => {
  const n = get('SELECT * FROM notes WHERE id = ? AND expires_at > ?', Number(id), nowIso());
  if (!n || (n.user_id !== me && (!areFriends(me, n.user_id) || blockedIds(me).includes(n.user_id)))) fail(404, 'This note has expired.');
  return n;
};

r.get('/notes', h((req, res) => {
  const me = req.user.id;
  const hidden = new Set(blockedIds(me));
  const ids = [me, ...friendIds(me)].filter((x) => !hidden.has(x));
  const ph = ids.map(() => '?').join(',');
  const rows = all(`SELECT * FROM notes WHERE user_id IN (${ph}) AND expires_at > ? ORDER BY id DESC`, ...ids, nowIso());
  const mine = rows.find((n) => n.user_id === me);
  res.json({ mine: mine ? noteOut(mine, me) : null, friends: rows.filter((n) => n.user_id !== me).map((n) => noteOut(n, me)) });
}));

r.post('/notes', h((req, res) => {
  const text = String(req.body?.text || '').trim();
  const { mood = null } = req.body || {};
  const emoji = String(req.body?.emoji || '').slice(0, 16) || null;
  const color = HEX.test(req.body?.color || '') ? req.body.color : null;
  const max = Number(getSetting('note_max_words')) || 35;
  if (mood && !MOOD_KEYS.includes(mood)) fail(400, 'Unknown mood.');
  if (!text && !emoji) fail(400, 'Write a note or add an emoji.');
  if (wordCount(text) > max) fail(400, `Notes are limited to ${max} words.`);
  if (text.length > 400) fail(400, 'Note is too long.');
  tx(() => {
    run('DELETE FROM notes WHERE user_id = ?', req.user.id); // one active note per user
    run('INSERT INTO notes (user_id, text, mood, theme, emoji, color, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      req.user.id, text, mood || '', 'midnight', emoji, color, hoursFromNow(Number(getSetting('note_hours')) || 24));
  });
  if (mood) logMood(req.user.id, mood, 'note');
  res.status(201).json(noteOut(get('SELECT * FROM notes WHERE user_id = ?', req.user.id), req.user.id));
}));

r.delete('/notes/me', h((req, res) => {
  run('DELETE FROM notes WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
}));

r.post('/notes/:id/like', h((req, res) => {
  const n = visibleNote(req.params.id, req.user.id);
  if (n.user_id === req.user.id) fail(400, "You can't like your own note.");
  const had = get('SELECT 1 x FROM note_likes WHERE note_id = ? AND user_id = ?', n.id, req.user.id);
  if (had) run('DELETE FROM note_likes WHERE note_id = ? AND user_id = ?', n.id, req.user.id);
  else {
    run('INSERT INTO note_likes (note_id, user_id) VALUES (?, ?)', n.id, req.user.id);
    notify({ userId: n.user_id, type: 'like', actorId: req.user.id, entityType: 'note', entityId: n.id, title: 'Note liked', body: `${req.user.full_name} liked your note${n.text ? `: “${n.text.slice(0, 60)}”` : '.'}` });
  }
  res.json({ liked: !had });
}));

// Reply privately: lands in your direct chat with the note's owner, quoting the note.
r.post('/notes/:id/reply', h((req, res) => {
  const n = visibleNote(req.params.id, req.user.id);
  if (n.user_id === req.user.id) fail(400, "You can't reply to your own note.");
  const text = String(req.body?.text || '').trim().slice(0, 1000);
  if (!text) fail(400, 'Write a reply.');
  const key = [req.user.id, n.user_id].sort((x, y) => x - y).join(':');
  let conv = get('SELECT * FROM conversations WHERE direct_key = ?', key);
  if (!conv) {
    const cid = Number(run("INSERT INTO conversations (type, direct_key, created_by) VALUES ('direct', ?, ?)", key, req.user.id).lastInsertRowid);
    run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', cid, req.user.id);
    run('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', cid, n.user_id);
    conv = { id: cid };
  }
  postMessage({ conversationId: conv.id, sender: req.user, text, noteRef: { text: n.text, emoji: n.emoji, color: n.color, owner: n.user_id } });
  res.json({ conversationId: conv.id });
}));

// ---------- Daily mood check-in ----------
r.get('/moods/today', h((req, res) => {
  res.json(get("SELECT mood, created_at FROM mood_logs WHERE user_id = ? AND day = ? AND source = 'checkin' ORDER BY id DESC LIMIT 1", req.user.id, localDay()) || null);
}));

r.post('/moods/checkin', h((req, res) => {
  const { mood } = req.body || {};
  if (!MOOD_KEYS.includes(mood)) fail(400, 'Unknown mood.');
  const existing = get("SELECT id FROM mood_logs WHERE user_id = ? AND day = ? AND source = 'checkin'", req.user.id, localDay());
  if (existing) run('UPDATE mood_logs SET mood = ?, created_at = ? WHERE id = ?', mood, nowIso(), existing.id);
  else logMood(req.user.id, mood, 'checkin');
  res.json({ mood });
}));

r.get('/moods/history', h((req, res) => {
  res.json(all("SELECT day, mood, source, created_at FROM mood_logs WHERE user_id = ? ORDER BY id DESC LIMIT 60", req.user.id));
}));

export default r;
