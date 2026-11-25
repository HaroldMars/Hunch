import { Router } from 'express';
import { get, all, run, userSettings } from '../db.js';
import { auth } from '../auth.js';
import { h, fail, publicUser, friendIds, blockedIds, nowIso, areFriends } from '../util.js';
import { emitToUsers } from '../realtime.js';
import { notify } from '../notify.js';
import { searchPlaces, reversePlace, planRoute, remainingAlong, haversine, trafficLevelNow, liveLevels } from '../geo.js';
import { storyOut, sharesLocation, canSeeStory } from './stories.js';

const r = Router();
r.use(auth());

const MODES = ['walk', 'motorcycle', 'car'];
const MODE_LABEL = { walk: 'walking', motorcycle: 'by motorcycle', car: 'by car' };
const num = (v, lim) => {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > lim) fail(400, 'Invalid coordinates.');
  return n;
};
const point = (p) => [num(p?.lat, 90), num(p?.lng, 180)];
// Friends who can see my location data (only when I share with friends), minus anyone blocked.
const audience = (uid) => {
  if (!sharesLocation(uid)) return [];
  const hidden = new Set(blockedIds(uid));
  return friendIds(uid).filter((id) => !hidden.has(id));
};
const visibleFriends = (me) => {
  const hidden = new Set(blockedIds(me));
  return friendIds(me).filter((id) => !hidden.has(id) && sharesLocation(id));
};

// ---------- places ----------
r.get('/map/search', h(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (q.length < 2) return res.json([]);
  const near = req.query.lat ? [Number(req.query.lat), Number(req.query.lng)] : null;
  try { res.json(await searchPlaces(q, near && near.every(Number.isFinite) ? near : null)); } catch (e) { fail(502, 'Place search is unavailable right now. Check your internet connection.'); }
}));
r.get('/map/reverse', h(async (req, res) => {
  const [lat, lng] = point(req.query);
  try { res.json(await reversePlace(lat, lng)); } catch { res.json({ name: 'Pinned location', lat, lng }); }
}));

// ---------- trips (shape) ----------
function tripOut(t, viewerId) {
  // Route, start, destination and ETA belong to the traveller only.
  // Friends of a shared trip get the live position and transport mode — never where they're going.
  if (t.user_id !== viewerId) {
    return {
      id: t.id, user: publicUser(t.user_id), mine: false, mode: t.mode, status: t.status, shared: !!t.shared,
      current: t.cur_lat != null ? { lat: t.cur_lat, lng: t.cur_lng } : { lat: t.origin_lat, lng: t.origin_lng },
      started_at: t.started_at, updated_at: t.updated_at,
    };
  }
  const route = JSON.parse(t.route);
  const live = liveLevels(route, t.mode);
  return {
    id: t.id, user: publicUser(t.user_id), mine: t.user_id === viewerId, mode: t.mode, status: t.status, shared: !!t.shared,
    origin: { name: t.origin_name, lat: t.origin_lat, lng: t.origin_lng },
    dest: { name: t.dest_name, lat: t.dest_lat, lng: t.dest_lng },
    route: route.coords, levels: live.levels, traffic: live.traffic, source: t.route_source,
    distance: t.distance_m, duration: t.duration_s,
    current: t.cur_lat != null ? { lat: t.cur_lat, lng: t.cur_lng } : { lat: t.origin_lat, lng: t.origin_lng },
    remaining: t.remaining_m ?? t.distance_m, eta: t.eta_s ?? t.duration_s,
    arrive_at: new Date(new Date(t.updated_at).getTime() + (t.eta_s ?? t.duration_s) * 1000).toISOString(),
    started_at: t.started_at, updated_at: t.updated_at,
  };
}
const broadcastTrip = (t) => {
  const ids = [t.user_id, ...(t.shared ? audience(t.user_id) : [])];
  ids.forEach((uid) => emitToUsers([uid], 'trip:update', tripOut(t, uid)));
};
const myTrip = (id, uid) => {
  const t = get('SELECT * FROM trips WHERE id = ? AND user_id = ?', Number(id), uid);
  if (!t) fail(404, 'Trip not found.');
  return t;
};

// ---------- overview ----------
r.get('/map/overview', h((req, res) => {
  const me = req.user.id;
  const friends = visibleFriends(me);
  const ids = [me, ...friends];
  const ph = ids.map(() => '?').join(',');
  // Location-tagged stories that are still live (own ones always, friends' only if they share location).
  // Friends' map stories, plus Public stories anyone put on Map Discovery.
  const stories = all(`SELECT * FROM stories WHERE (user_id IN (${ph}) OR audience = 'public') AND lat IS NOT NULL AND show_on_map = 1 AND audience <> 'private' AND expires_at > ? ORDER BY id DESC LIMIT 400`, ...ids, nowIso())
    .filter((s) => canSeeStory(s, me))
    .map((s) => ({ ...storyOut(s, me), user: publicUser(s.user_id) }));
  const people = all(`SELECT * FROM user_locations WHERE user_id IN (${ph})`, ...ids).map((l) => ({ ...l, user: publicUser(l.user_id), me: l.user_id === me }));
  const trips = all(`SELECT * FROM trips WHERE status = 'active' AND (user_id = ? OR (shared = 1 AND user_id IN (${friends.map(() => '?').join(',') || 'NULL'})))`, me, ...friends)
    .map((t) => tripOut(t, me));
  res.json({ sharing: userSettings(me).location_sharing, stories, people, trips, traffic: trafficLevelNow() });
}));

// ---------- live location ----------
r.put('/map/location', h(async (req, res) => {
  if (!sharesLocation(req.user.id)) fail(403, 'Location sharing is private. Turn it on to share where you are with friends.');
  const [lat, lng] = point(req.body);
  let place = String(req.body?.place_name || '').slice(0, 120) || null;
  if (!place) { try { place = (await reversePlace(lat, lng)).name; } catch { place = null; } }
  run(`INSERT INTO user_locations (user_id, lat, lng, place_name, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, place_name = excluded.place_name, updated_at = excluded.updated_at`,
  req.user.id, lat, lng, place, nowIso());
  const loc = { ...get('SELECT * FROM user_locations WHERE user_id = ?', req.user.id), user: publicUser(req.user.id) };
  emitToUsers(audience(req.user.id), 'location:update', loc);
  res.json(loc);
}));
r.delete('/map/location', h((req, res) => {
  run('DELETE FROM user_locations WHERE user_id = ?', req.user.id);
  emitToUsers(friendIds(req.user.id), 'location:remove', { user_id: req.user.id });
  res.json({ ok: true });
}));

// ---------- trips ----------
r.post('/trips', h(async (req, res) => {
  const mode = MODES.includes(req.body?.mode) ? req.body.mode : fail(400, 'Choose walking, motorcycle or car.');
  const a = point(req.body?.origin);
  const b = point(req.body?.dest);
  if (haversine(a, b) < 30) fail(400, 'Your destination is right here.');
  if (haversine(a, b) > 1500e3) fail(400, 'That destination is too far for a live trip.');
  const shared = !!req.body?.shared;
  if (shared && !sharesLocation(req.user.id)) fail(403, 'Turn on location sharing to share your trip with friends.');
  const plan = await planRoute(mode, a, b);
  run("UPDATE trips SET status = 'ended', ended_at = ? WHERE user_id = ? AND status = 'active'", nowIso(), req.user.id); // one active trip
  const id = Number(run(
    `INSERT INTO trips (user_id, mode, origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng, route, route_source, distance_m, duration_s, cur_lat, cur_lng, remaining_m, eta_s, shared)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    req.user.id, mode, String(req.body.origin.name || 'Start').slice(0, 120), a[0], a[1], String(req.body.dest.name || 'Destination').slice(0, 120), b[0], b[1],
    JSON.stringify({ coords: plan.coords, levels: plan.levels, speeds: plan.speeds, traffic: plan.traffic }), plan.source, plan.distance, plan.duration, a[0], a[1], plan.distance, plan.duration, shared ? 1 : 0
  ).lastInsertRowid);
  const t = get('SELECT * FROM trips WHERE id = ?', id);
  if (shared) announceTrip(t, req.user);
  broadcastTrip(t);
  res.status(201).json(tripOut(t, req.user.id));
}));
function announceTrip(t, u) {
  audience(u.id).forEach((fid) => notify({ userId: fid, type: 'trip', actorId: u.id, entityType: 'trip', entityId: t.id, title: 'Trip shared with you',
    body: `${u.full_name} is on the move ${MODE_LABEL[t.mode]}. See their live position on the map.` }));
}
r.get('/trips/mine/active', h((req, res) => {
  const t = get("SELECT * FROM trips WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1", req.user.id);
  res.json(t ? tripOut(t, req.user.id) : null);
}));
r.get('/trips/:id', h((req, res) => {
  const t = get('SELECT * FROM trips WHERE id = ?', Number(req.params.id));
  const ok = t && (t.user_id === req.user.id || (t.shared && sharesLocation(t.user_id) && areFriends(req.user.id, t.user_id) && !blockedIds(req.user.id).includes(t.user_id)));
  if (!ok) fail(404, 'Trip not found.');
  res.json(tripOut(t, req.user.id));
}));
r.post('/trips/:id/position', h((req, res) => {
  const t = myTrip(req.params.id, req.user.id);
  if (t.status !== 'active') fail(400, 'This trip has ended.');
  const pos = point(req.body);
  const route = JSON.parse(t.route);
  const remaining = remainingAlong(route.coords, pos);
  // ETA keeps the planned pace (traffic-adjusted average speed) for the distance left.
  const pace = t.duration_s / Math.max(t.distance_m, 1);
  const eta = remaining * pace;
  const arrived = haversine(pos, [t.dest_lat, t.dest_lng]) < 60 || remaining < 40;
  run(`UPDATE trips SET cur_lat = ?, cur_lng = ?, remaining_m = ?, eta_s = ?, updated_at = ?, status = ?, ended_at = ? WHERE id = ?`,
    pos[0], pos[1], arrived ? 0 : remaining, arrived ? 0 : eta, nowIso(), arrived ? 'arrived' : 'active', arrived ? nowIso() : null, t.id);
  const t2 = get('SELECT * FROM trips WHERE id = ?', t.id);
  if (arrived && t2.shared) audience(req.user.id).forEach((fid) => notify({ userId: fid, type: 'trip', actorId: req.user.id, entityType: 'trip', entityId: t.id, title: 'Arrived', body: `${req.user.full_name} has arrived safely.` }));
  broadcastTrip(t2);
  res.json(tripOut(t2, req.user.id));
}));
r.patch('/trips/:id', h((req, res) => {
  const t = myTrip(req.params.id, req.user.id);
  if (req.body?.shared !== undefined) {
    const shared = !!req.body.shared;
    if (shared && !sharesLocation(req.user.id)) fail(403, 'Turn on location sharing to share your trip with friends.');
    run('UPDATE trips SET shared = ? WHERE id = ?', shared ? 1 : 0, t.id);
    if (shared && !t.shared && t.status === 'active') announceTrip(t, req.user);
    if (!shared) emitToUsers(friendIds(req.user.id), 'trip:remove', { id: t.id });
  }
  const t2 = get('SELECT * FROM trips WHERE id = ?', t.id);
  broadcastTrip(t2);
  res.json(tripOut(t2, req.user.id));
}));
r.post('/trips/:id/end', h((req, res) => {
  const t = myTrip(req.params.id, req.user.id);
  run("UPDATE trips SET status = 'ended', ended_at = ? WHERE id = ? AND status = 'active'", nowIso(), t.id);
  emitToUsers([req.user.id, ...friendIds(req.user.id)], 'trip:remove', { id: t.id });
  res.json({ ok: true });
}));

export default r;
