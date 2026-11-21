// Demo content for v0.3 (map, work feed, schedules) on top of `npm run seed:demo`.
// Only touches the demo organisation (…@hunch.local demo people). Safe to re-run:
// work posts/schedules are added once; location stories and the shared trip are refreshed
// because stories expire after 24 hours.
// Usage: npm run seed:v3
import { get, all, run, tx, getSetting, setSetting, userSettings } from '../src/db.js';
import { localDay, addDays, hoursFromNow, nowIso } from '../src/util.js';
import { planRoute } from '../src/geo.js';
// Demo data is for local development only. It must never reach a production database.
if (process.env.NODE_ENV === 'production') { console.error('Refusing to add demo data: NODE_ENV is production.'); process.exit(1); }

const byEmail = (e) => get('SELECT * FROM users WHERE email = ?', e);
if (!byEmail('maria.santos@hunch.local')) {
  console.log('Run `npm run seed:demo` first. This adds to the demo organisation.');
  process.exit(0);
}
const P = (name) => byEmail(`${name.toLowerCase().replace(/[^a-z]+/g, '.')}@hunch.local`);
const share = (u) => {
  const s = userSettings(u.id);
  run('UPDATE users SET settings = ? WHERE id = ?', JSON.stringify({ ...s, location_sharing: 'friends' }), u.id);
};
// Demo people only — never the initial admin or anyone else's real account.
const DEMO = ['Ben Lim', 'Clara Uy', 'Diego Ramos', 'Ella Tan', 'Carla Reyes', 'Paolo Garcia', 'Franco Yap', 'Gia Mendoza'].map(P).filter(Boolean);
DEMO.forEach(share);

// ---------- location stories (refreshed every run) ----------
const PLACES = {
  ayala: ['Ayala Center Cebu', 10.3181, 123.9051],
  itpark: ['Cebu IT Park', 10.3302, 123.9063],
  seaside: ['SM Seaside City Cebu', 10.2817, 123.8807],
  fuente: ['Fuente Osmeña Circle', 10.3109, 123.8919],
  leah: ['Temple of Leah', 10.3696, 123.8710],
  tops: ['Tops Lookout, Busay', 10.3700, 123.8636],
};
const STORIES = [
  ['Ben Lim', 'itpark', 'excited', 'Team lunch at IT Park 🍜'],
  ['Clara Uy', 'itpark', 'happy', 'Coffee before shift ☕'],
  ['Diego Ramos', 'itpark', 'tired', 'Long day but we hit target'],
  ['Ella Tan', 'ayala', 'chill', 'Rest day stroll'],
  ['Carla Reyes', 'ayala', 'happy', 'Proud of the team this week 💙'],
  ['Paolo Garcia', 'tops', 'excited', 'Sunset at Tops 🌅'],
  ['Ben Lim', 'seaside', 'energetic', 'Sunday run by the sea'],
  ['Gia Mendoza', 'leah', 'curious', 'Finally visited Temple of Leah'],
  ['Franco Yap', 'fuente', 'chill', 'Late night eats'],
];
tx(() => {
  run(`DELETE FROM stories WHERE place_name IS NOT NULL AND user_id IN (${DEMO.map((u) => u.id).join(',')})`);
  STORIES.forEach(([who, place, mood, text], i) => {
    const u = P(who);
    if (!u) return;
    const [name, lat, lng] = PLACES[place];
    const j = () => (Math.random() - 0.5) * 0.0012;
    run(`INSERT INTO stories (user_id, text, mood, theme, place_name, lat, lng, allow_comments, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`, u.id, text, mood, ['ocean', 'sunset', 'berry', 'aurora'][i % 4], name, lat + j(), lng + j(),
    new Date(Date.now() - (i + 1) * 47 * 60e3).toISOString(), hoursFromNow(20));
  });
});

// ---------- last shared locations ----------
[['Clara Uy', 'itpark'], ['Ella Tan', 'ayala'], ['Paolo Garcia', 'fuente']].forEach(([who, place]) => {
  const u = P(who);
  const [name, lat, lng] = PLACES[place];
  run(`INSERT INTO user_locations (user_id, lat, lng, place_name, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, place_name = excluded.place_name, updated_at = excluded.updated_at`,
  u.id, lat + 0.0006, lng - 0.0004, name, new Date(Date.now() - 12 * 60e3).toISOString());
});

// ---------- a shared trip in progress ----------
const ben = P('Ben Lim');
run("UPDATE trips SET status = 'ended', ended_at = ? WHERE user_id = ? AND status = 'active'", nowIso(), ben.id);
const a = [10.2817, 123.8807];
const b = [10.3302, 123.9063];
const plan = await planRoute('motorcycle', a, b);
const cut = Math.floor(plan.coords.length * 0.3);
const cur = plan.coords[cut] || a;
const left = plan.distance * 0.7;
run(`INSERT INTO trips (user_id, mode, origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng, route, route_source, distance_m, duration_s, cur_lat, cur_lng, remaining_m, eta_s, shared, started_at, updated_at)
     VALUES (?, 'motorcycle', 'SM Seaside City Cebu', ?, ?, 'Cebu IT Park', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
ben.id, a[0], a[1], b[0], b[1], JSON.stringify({ coords: plan.coords, levels: plan.levels, speeds: plan.speeds, traffic: plan.traffic }), plan.source,
plan.distance, plan.duration, cur[0], cur[1], left, plan.duration * 0.7, new Date(Date.now() - 6 * 60e3).toISOString(), nowIso());
console.log(`Shared trip for Ben Lim: ${(plan.distance / 1000).toFixed(1)} km via ${plan.source}.`);

// ---------- work feed + schedules (once) ----------
if (getSetting('seed_v3_work') !== '1') {
  const teams = all("SELECT * FROM users WHERE role = 'tl' AND email LIKE '%@hunch.local' ORDER BY id");
  const monday = (() => { const d = new Date(); const dow = (d.getDay() + 6) % 7; return localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow)); })();
  tx(() => {
    teams.forEach((tl, ti) => {
      const sme = get("SELECT * FROM users WHERE role = 'sme' AND team_leader_id = ?", tl.id);
      const agents = all("SELECT * FROM users WHERE role = 'agent' AND team_leader_id = ? AND email NOT LIKE 'test.agent%' ORDER BY id", tl.id);
      const first = tl.full_name.split(' ')[0];
      const post = (u, text, kind = 'post', pinned = 0, hoursAgo = 2) =>
        run('INSERT INTO posts (user_id, text, team_id, kind, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)', u.id, text, tl.id, kind, pinned, new Date(Date.now() - hoursAgo * 3600e3).toISOString());
      post(tl, `Welcome to Team ${first}'s Work feed! 📌 Schedules, announcements and team updates live here. Only our team can see it.`, 'announcement', 1, 30);
      post(tl, 'Reminder: QA calibration on Thursday 3 PM. Bring two calls you want feedback on.', 'announcement', 0, 20);
      if (sme) post(sme, 'Updated the refund macro. Use v3 from today. Ping me if a case doesn’t fit.', 'post', 0, 9);
      post(tl, `Great week everyone! CSAT up ${3 + ti}% 🎉 Thank you for the energy.`, 'post', 0, 3);
      // Weekly schedule: shifts Mon–Fri, lunch, Monday huddle, rest days, a coaching and an overtime slot.
      const add = (kind, day, start, end, userId = null, title = '') =>
        run('INSERT INTO schedules (team_id, user_id, kind, title, day, start_time, end_time, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', tl.id, userId, kind, title, day, start, end, tl.id);
      for (let w = 0; w < 3; w++) {
        for (let d = 0; d < 5; d++) {
          const day = addDays(monday, w * 7 + d);
          add('shift', day, ti === 1 ? '09:00' : '08:00', ti === 1 ? '18:00' : '17:00');
          add('lunch', day, '12:00', '13:00');
        }
        add('meeting', addDays(monday, w * 7), '09:00', '09:30', null, 'Weekly huddle');
        add('rest', addDays(monday, w * 7 + 5), null, null);
        add('rest', addDays(monday, w * 7 + 6), null, null);
        add('training', addDays(monday, w * 7 + 3), '15:00', '16:00', null, 'QA calibration');
      }
      if (agents[1]) add('coaching', addDays(monday, 2), '15:00', '15:30', agents[1].id, '1:1 coaching');
      if (agents[2]) add('overtime', addDays(monday, 4), '17:00', '19:00', agents[2].id, 'Backlog clean-up');
      if (ti === 0) {
        run('INSERT OR REPLACE INTO team_settings (team_id, members_can_post) VALUES (?, 1)', tl.id);
        if (agents[1]) run("INSERT OR REPLACE INTO post_permissions (team_id, user_id, status, decided_by, decided_at) VALUES (?, ?, 'approved', ?, ?)", tl.id, agents[1].id, tl.id, nowIso());
        if (agents[2]) run("INSERT OR REPLACE INTO post_permissions (team_id, user_id, status, note) VALUES (?, ?, 'pending', 'I''d like to share shift-swap requests here.')", tl.id, agents[2].id);
        if (agents[1]) post(agents[1], 'Anyone up for a Saturday badminton game? 🏸', 'post', 0, 1);
      }
    });
  });
  setSetting('seed_v3_work', '1');
  console.log(`Work feed and 3 weeks of schedules added for ${teams.length} teams.`);
}
console.log('v0.3 demo content ready: location stories, shared locations and a shared trip in Cebu.');
