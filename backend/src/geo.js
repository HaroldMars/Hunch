// Free, self-hostable map services only:
//  - Place search / reverse geocoding: OpenStreetMap Nominatim (max 1 request per second, cached).
//  - Routing: OpenRouteService when ORS_API_KEY (or the ors_api_key setting) is set, otherwise the
//    free FOSSGIS OSRM servers at routing.openstreetmap.de, and finally a straight-line estimate offline.
//  - Traffic: there is no free live-traffic feed, so congestion is *estimated* from the time of day
//    and road speed. The API labels it that way and the UI says so.
import { getSetting } from './db.js';

const UA = 'Hunch/0.3 (self-hosted team engagement app)';
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
export const haversine = (a, b) => {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

// ---------- Nominatim ----------
const cache = new Map();
let queue = Promise.resolve();
let last = 0;
function nominatim(path) {
  if (cache.has(path)) return Promise.resolve(cache.get(path));
  const job = queue.then(async () => {
    const wait = Math.max(0, last + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(`https://nominatim.openstreetmap.org/${path}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Place search failed (${res.status})`);
    const data = await res.json();
    if (cache.size > 500) cache.clear();
    cache.set(path, data);
    return data;
  });
  queue = job.catch(() => {});
  return job;
}
const shortName = (p) => {
  const a = p.address || {};
  const main = p.name || a.amenity || a.building || a.road || a.suburb || a.village || a.town || a.city || '';
  const area = a.city || a.town || a.municipality || a.village || a.county || a.state || '';
  return main && area && main !== area ? `${main}, ${area}` : main || area || p.display_name?.split(',').slice(0, 2).join(',') || 'Pinned location';
};
export async function searchPlaces(q, near) {
  const params = new URLSearchParams({ q, format: 'jsonv2', addressdetails: '1', limit: '6' });
  if (near) params.set('viewbox', `${near[1] - 1},${near[0] + 1},${near[1] + 1},${near[0] - 1}`);
  const rows = await nominatim(`search?${params}`);
  return rows.map((p) => ({ name: shortName(p), display: p.display_name, lat: Number(p.lat), lng: Number(p.lon) }));
}
export async function reversePlace(lat, lng) {
  const p = await nominatim(`reverse?${new URLSearchParams({ lat: lat.toFixed(5), lon: lng.toFixed(5), format: 'jsonv2', addressdetails: '1', zoom: '16' })}`);
  return { name: p?.error ? 'Pinned location' : shortName(p), display: p?.display_name || '', lat, lng };
}

// ---------- Traffic estimate ----------
// 0 = smooth, 1 = moderate, 2 = heavy. Based on local time: weekday rush hours are heavy on main roads.
export function trafficLevelNow(d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  if (weekend) return h >= 10 && h < 20 ? 1 : 0;
  if ((h >= 7 && h < 9.5) || (h >= 17 && h < 19.5)) return 2;
  if ((h >= 11.5 && h < 13.5) || (h >= 16 && h < 17) || (h >= 9.5 && h < 10.5)) return 1;
  return 0;
}
const FACTOR = { car: [1, 1.3, 1.75], motorcycle: [0.9, 1.05, 1.3], walk: [1, 1, 1] };
const WALK_MPS = 1.35; // ~4.9 km/h

/**
 * Per-step congestion, 0 = no traffic (green), 1 = slow flow (orange), 2 = heavy traffic (red).
 * Main roads (≥45 km/h) take the full time-of-day level, mid roads one step lighter,
 * quiet local streets stay green unless it's rush hour.
 */
export function stepLevels(speeds, base) {
  return speeds.map((kmh) => {
    if (kmh == null) return base;
    if (kmh >= 45) return base;
    if (kmh >= 25) return base === 2 ? 1 : 0;
    return base === 2 ? 1 : 0;
  });
}
/** Current colours for a stored route (recomputed on every read so they follow the clock). */
export function liveLevels(route, mode) {
  const steps = Math.max(0, (route.coords?.length || 1) - 1);
  if (mode === 'walk') return { levels: Array(steps).fill(0), traffic: 0 };
  const base = trafficLevelNow();
  if (route.speeds?.length === steps) return { levels: stepLevels(route.speeds, base), traffic: base };
  return { levels: route.levels || Array(steps).fill(base), traffic: route.traffic ?? base };
}

// ---------- Routing ----------
async function viaOrs(mode, a, b, key) {
  const profile = mode === 'walk' ? 'foot-walking' : 'driving-car';
  const res = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
    method: 'POST', headers: { Authorization: key, 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ coordinates: [[a[1], a[0]], [b[1], b[0]]] }), signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`OpenRouteService ${res.status}`);
  const f = (await res.json()).features?.[0];
  if (!f) throw new Error('No route');
  return { coords: f.geometry.coordinates.map(([lng, lat]) => [lat, lng]), distance: f.properties.summary.distance, duration: f.properties.summary.duration, speeds: null, source: 'openrouteservice' };
}
async function viaOsrm(mode, a, b) {
  const svc = mode === 'walk' ? 'routed-foot' : 'routed-car';
  const url = `https://routing.openstreetmap.de/${svc}/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson&annotations=speed`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const rt = (await res.json()).routes?.[0];
  if (!rt) throw new Error('No route');
  const speeds = rt.legs?.[0]?.annotation?.speed?.map((mps) => mps * 3.6) || null;
  return { coords: rt.geometry.coordinates.map(([lng, lat]) => [lat, lng]), distance: rt.distance, duration: rt.duration, speeds, source: 'osrm' };
}
function straightLine(mode, a, b) {
  const d = haversine(a, b) * 1.3; // road detour allowance
  const mps = mode === 'walk' ? WALK_MPS : mode === 'motorcycle' ? 9 : 8;
  return { coords: [a, b], distance: d, duration: d / mps, speeds: null, source: 'estimate' };
}

/** Plan a route and attach the estimated traffic per step and the adjusted ETA. */
export async function planRoute(mode, a, b) {
  const key = process.env.ORS_API_KEY || getSetting('ors_api_key');
  let r;
  try {
    r = key ? await viaOrs(mode, a, b, key) : await viaOsrm(mode, a, b);
  } catch (e) {
    console.warn('[hunch] routing service unavailable, using straight-line estimate:', e.message);
    r = straightLine(mode, a, b);
  }
  const base = mode === 'walk' ? 0 : trafficLevelNow();
  const steps = r.coords.length - 1;
  const levels = mode === 'walk' ? Array(steps).fill(0) : r.speeds && r.speeds.length === steps ? stepLevels(r.speeds, base) : Array(steps).fill(base);
  let duration = mode === 'walk' ? (r.source === 'estimate' ? r.duration : Math.max(r.duration, r.distance / WALK_MPS)) : r.duration * FACTOR[mode][base];
  if (mode === 'motorcycle' && r.source !== 'estimate') duration *= 0.9;
  return { coords: r.coords, levels, speeds: r.speeds && r.speeds.length === steps ? r.speeds.map((v) => Math.round(v)) : null, distance: r.distance, duration, source: r.source, traffic: base };
}

/** Project a position onto the route; returns the remaining distance along it. */
export function remainingAlong(coords, pos) {
  if (coords.length < 2) return haversine(pos, coords[0] || pos);
  const seg = [];
  for (let i = coords.length - 2; i >= 0; i--) seg[i] = haversine(coords[i], coords[i + 1]) + (seg[i + 1] || 0);
  let best = { d: Infinity, rem: seg[0] };
  const kx = Math.cos(rad(pos[0])) * 111320;
  const ky = 110540;
  for (let i = 0; i < coords.length - 1; i++) {
    const [ay, ax] = [coords[i][0] * ky, coords[i][1] * kx];
    const [by, bx] = [coords[i + 1][0] * ky, coords[i + 1][1] * kx];
    const [py, px] = [pos[0] * ky, pos[1] * kx];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best.d) best = { d, rem: (1 - t) * Math.sqrt(len2) + (seg[i + 1] || 0) };
  }
  // Off-route: fall back to the straight-line distance to the destination when that is larger.
  return best.d > 300 ? Math.max(best.rem, haversine(pos, coords[coords.length - 1])) : best.rem;
}
