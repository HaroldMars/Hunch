import { get, all } from './db.js';
import { friendIds, blockedIds, parseList } from './util.js';

// "For You": a personal, shuffled mix of new, popular and relevant posts.
// Each post gets a score from:
//   recency    newer posts first (fades over ~2 days)
//   popularity likes, comments and reposts
//   relevance  words matching what you search for, your interests, and posts you liked
//   closeness  friends and people whose posts you like or comment on
//   shuffle    a random nudge that changes on every refresh, so the feed feels fresh
// Then no author appears twice in a row (or more than twice in any 6 posts).

const STOP = new Set('the and for you your with this that have from are was were they them what when where who how why just like about been into than then there their will would could should not but all any can our out get got too very really also more most some much many only over still even here want need make made know think day today time back going good great new one two'.split(' '));
const INTEREST_WORDS = {
  Music: 'music song songs album concert band playlist spotify guitar sing singing gig dj',
  Gaming: 'game games gaming gamer play playing ps5 xbox nintendo steam valorant ml mobile legends dota minecraft',
  Travel: 'travel trip vacation beach flight island hotel tour explore adventure airport road',
  Food: 'food eat eating lunch dinner breakfast coffee cafe restaurant pizza ramen recipe cook cooking dessert milktea',
  Fitness: 'gym workout fitness run running training exercise yoga hike hiking cardio lift',
  Art: 'art drawing painting sketch design artist illustration creative',
  Photography: 'photo photos photography camera shot shoot sunset portrait lens',
  Movies: 'movie movies film cinema netflix series watch watching show episode anime',
  Books: 'book books reading read novel author library story',
  Tech: 'tech code coding programming developer app software ai computer laptop phone gadget',
  Sports: 'sport sports basketball football soccer volleyball nba game match team',
  Fashion: 'fashion outfit style clothes shoes ootd wear',
  Business: 'business startup work job career money market sales marketing office',
  Education: 'school study studying class exam college university learn learning',
  Nature: 'nature mountain forest sea ocean garden plants flowers sunrise sky',
  Pets: 'pet pets dog dogs cat cats puppy kitten',
};

export const tokens = (s) => (String(s || '').toLowerCase().match(/[#@]?[\p{L}\p{N}]{3,}/gu) || []).map((t) => t.replace(/^[#@]/, '')).filter((t) => !STOP.has(t));

/** A stable pseudo-random number in [0, 1) for this seed and post, so pages of one refresh agree. */
function jitter(seed, id) {
  let h = 2166136261 ^ seed;
  for (const c of String(id)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** What this person is into: recent searches, interests, and words from posts they liked. */
export function tasteOf(me) {
  const searches = all('SELECT query FROM search_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', me).map((r) => r.query);
  const search = new Map();
  searches.forEach((q) => tokens(q).forEach((t) => { if (!search.has(t)) search.set(t, q); }));
  const interests = new Map();
  parseList(get('SELECT interests FROM users WHERE id = ?', me)?.interests).forEach((label) => (INTEREST_WORDS[label] || label.toLowerCase()).split(' ').forEach((w) => interests.set(w, label)));
  const counts = new Map();
  all('SELECT p.text FROM likes l JOIN posts p ON p.id = l.post_id WHERE l.user_id = ? ORDER BY l.created_at DESC LIMIT 60', me)
    .forEach((r) => new Set(tokens(r.text)).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  const liked = new Set([...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([t]) => t));
  return { search, interests, liked };
}

/** Ranked For You feed for one refresh (`seed`), one page at a time. */
export function forYou(me, { seed = 1, page = 0, size = 15 } = {}) {
  const friends = new Set(friendIds(me));
  const ids = [me, ...friends];
  const ph = ids.map(() => '?').join(',');
  const hidden = new Set(blockedIds(me));
  const pool = (since) => all(
    `SELECT p.* FROM posts p JOIN users u ON u.id = p.user_id
     WHERE u.status = 'active' AND p.team_id IS NULL AND (p.user_id IN (${ph}) OR u.privacy = 'public') ${since ? 'AND p.created_at >= ?' : ''}
     ORDER BY p.id DESC LIMIT 500`, ...ids, ...(since ? [since] : []));
  let rows = pool(new Date(Date.now() - 45 * 864e5).toISOString());
  if (rows.length < 40) rows = pool(null);
  rows = rows.filter((p) => !hidden.has(p.user_id));
  if (!rows.length) return { rows: [], next: null };

  const pids = rows.map((p) => p.id);
  const inList = pids.map(() => '?').join(',');
  const count = (sql) => new Map(all(sql, ...pids).map((r) => [r.k, r.c]));
  const likes = count(`SELECT post_id k, COUNT(*) c FROM likes WHERE post_id IN (${inList}) GROUP BY post_id`);
  const comments = count(`SELECT post_id k, COUNT(*) c FROM comments WHERE post_id IN (${inList}) GROUP BY post_id`);
  const reposts = count(`SELECT repost_of k, COUNT(*) c FROM posts WHERE repost_of IN (${inList}) GROUP BY repost_of`);
  const mine = new Set(all(`SELECT post_id k FROM likes WHERE user_id = ? AND post_id IN (${inList})`, me, ...pids).map((r) => r.k));
  // Closeness: how often you like or comment on each author's posts.
  const close = new Map(all(
    `SELECT p.user_id k, COUNT(*) c FROM (SELECT post_id FROM likes WHERE user_id = ? UNION ALL SELECT post_id FROM comments WHERE user_id = ?) x
     JOIN posts p ON p.id = x.post_id WHERE p.user_id != ? GROUP BY p.user_id`, me, me, me).map((r) => [r.k, r.c]));
  const originals = new Map(all(`SELECT id, text FROM posts WHERE id IN (SELECT repost_of FROM posts WHERE id IN (${inList}) AND repost_of IS NOT NULL)`, ...pids).map((r) => [r.id, r.text]));
  const taste = tasteOf(me);
  const now = Date.now();

  const scored = rows.map((p) => {
    const ageH = Math.max(0, (now - Date.parse(p.created_at)) / 36e5);
    const recency = Math.exp(-ageH / 48);
    const target = p.repost_of || p.id;
    const eng = (likes.get(target) || 0) + 2 * (comments.get(target) || 0) + 3 * (reposts.get(target) || 0);
    const popularity = Math.min(1.5, Math.log1p(eng) / Math.log1p(40));
    const words = new Set(tokens(`${p.text} ${originals.get(p.repost_of) || ''}`));
    let rel = 0; let why = null;
    for (const w of words) {
      if (taste.search.has(w)) { rel += 1.2; why = why?.type === 'search' ? why : { type: 'search', term: taste.search.get(w) }; }
      else if (taste.interests.has(w)) { rel += 0.8; if (!why) why = { type: 'interest', label: taste.interests.get(w) }; }
      else if (taste.liked.has(w)) rel += 0.35;
    }
    rel = Math.min(2.2, rel);
    const social = p.user_id === me ? -0.5 : (friends.has(p.user_id) ? 0.55 : 0) + Math.min(0.8, Math.log1p(close.get(p.user_id) || 0) * 0.35);
    const seenPenalty = mine.has(target) ? 0.35 : 0;
    const score = 1.4 * recency + popularity + rel + social - seenPenalty + jitter(seed, p.id) * 0.9;
    // Why it's here (shown as a small label): searches and interests first, then popular or new.
    const reason = why || (eng >= 6 && popularity >= 0.6 ? { type: 'popular' } : ageH < 6 && p.user_id !== me ? { type: 'new' } : null);
    return { p, score, reason };
  }).sort((a, b) => b.score - a.score);

  // Spread authors out: never twice in a row, at most twice in any 6 posts.
  const out = [];
  const rest = [...scored];
  while (rest.length) {
    const recent = out.slice(-5).map((x) => x.p.user_id);
    let i = rest.findIndex((x) => x.p.user_id !== out.at(-1)?.p.user_id && recent.filter((u) => u === x.p.user_id).length < 2);
    if (i < 0) i = 0;
    out.push(rest.splice(i, 1)[0]);
  }
  const slice = out.slice(page * size, page * size + size);
  return { rows: slice, next: out.length > (page + 1) * size ? page + 1 : null };
}
