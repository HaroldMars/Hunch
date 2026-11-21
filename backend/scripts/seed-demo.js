// Optional: populate the local database with a demo organisation and 90 days of activity.
// Usage: npm run seed:demo   (refuses to run twice unless --force)
import bcrypt from 'bcryptjs';
import { db, get, run, all, tx, codeFor } from '../src/db.js';
import { localDay, addDays } from '../src/util.js';
import { MOODS } from '../../shared/constants.js';
// Demo data is for local development only. It must never reach a production database.
if (process.env.NODE_ENV === 'production') { console.error('Refusing to add demo data: NODE_ENV is production.'); process.exit(1); }

const FORCE = process.argv.includes('--force');
if (get("SELECT id FROM users WHERE email = 'maria.santos@hunch.local'") && !FORCE) {
  console.log('Demo data already present. Run with --force to add again (not recommended).');
  process.exit(0);
}

const PASSWORD = 'Hunch@2026';
const hash = bcrypt.hashSync(PASSWORD, 10);
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rand() * a.length)];
const today = localDay();
const isoAt = (day, h, m = 0) => {
  const [y, mo, d] = day.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m, Math.floor(rand() * 59)).toISOString();
};

function user(full_name, role, extra = {}) {
  const email = `${full_name.toLowerCase().replace(/[^a-z]+/g, '.')}@hunch.local`;
  const username = ['agent'].includes(role) ? null : full_name.toLowerCase().replace(/[^a-z]+/g, '');
  const r = run(
    `INSERT INTO users (username, email, password_hash, full_name, role, team_leader_id, job_title, bio, location, privacy,
      must_change_password, verified, profile_completed, created_at, last_active_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 1, ?, ?, ?)`,
    username, email, hash, full_name, role, extra.tl || null, extra.title || '', extra.bio || '', extra.location || 'Cebu City',
    extra.privacy || 'public', isoAt(addDays(today, -95), 9), isoAt(today, 8), isoAt(today, 8)
  );
  const id = Number(r.lastInsertRowid);
  run('UPDATE users SET user_code = ? WHERE id = ?', codeFor(id), id);
  return { id, full_name, role, email, username };
}

// Team mood "personalities" so the reports have something to compare.
const PROFILES = {
  sunny: { happy: 6, excited: 4, energetic: 4, chill: 4, curious: 3, tired: 2, lazy: 1, sleepy: 2, sad: 1, angry: 0.5 },
  steady: { happy: 4, excited: 2, energetic: 2, chill: 5, curious: 3, tired: 3, lazy: 2, sleepy: 3, sad: 1.5, angry: 1 },
  stressed: { happy: 2, excited: 1, energetic: 1, chill: 2, curious: 2, tired: 5, lazy: 2, sleepy: 4, sad: 3, angry: 3 },
};
const drawMood = (profile) => {
  const entries = Object.entries(profile);
  let x = rand() * entries.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of entries) { if ((x -= w) <= 0) return k; }
  return 'chill';
};

const people = [];
tx(() => {
  const manager = user('Maria Santos', 'manager', { title: 'Operations Manager', bio: 'Coffee, KPIs and good vibes.' });
  const teams = [
    { tl: 'Carla Reyes', sme: 'Paolo Garcia', profile: 'sunny', agents: ['Ana Villanueva', 'Ben Lim', 'Clara Uy', 'Diego Ramos', 'Ella Tan'] },
    { tl: 'Tristan Cruz', sme: 'Lea Navarro', profile: 'steady', agents: ['Franco Yap', 'Gia Mendoza', 'Hans Aquino', 'Iris Bautista', 'Jomar Flores'] },
    { tl: 'Nina Dela Paz', sme: 'Rico Santiago', profile: 'stressed', agents: ['Kaye Torres', 'Luis Castillo', 'Mika Ocampo', 'Noel Rivera', 'Olga Domingo'] },
  ];
  people.push({ ...manager, profile: 'steady' });
  for (const t of teams) {
    const tl = user(t.tl, 'tl', { title: 'Team Leader', bio: 'Here to help the team grow 🌱' });
    run('UPDATE users SET can_create_accounts = ? WHERE id = ?', t.profile === 'sunny' ? 1 : 0, tl.id);
    const sme = user(t.sme, 'sme', { tl: tl.id, title: 'Subject Matter Expert' });
    const agents = t.agents.map((n, i) => user(n, 'agent', { tl: tl.id, title: 'Customer Support Agent', privacy: i === 4 ? 'friends' : 'public' }));
    t.ids = [tl, sme, ...agents];
    people.push({ ...tl, profile: t.profile }, { ...sme, profile: t.profile }, ...agents.map((a) => ({ ...a, profile: t.profile })));
  }

  // Friendships: everyone within a team, TLs with each other and the manager, plus the initial admin.
  const befriend = (a, b, day) => run(
    "INSERT OR IGNORE INTO friendships (requester_id, addressee_id, status, created_at, accepted_at) VALUES (?, ?, 'accepted', ?, ?)",
    a, b, isoAt(day, 10), isoAt(day, 11)
  );
  for (const t of teams) for (let i = 0; i < t.ids.length; i++) for (let j = i + 1; j < t.ids.length; j++) befriend(t.ids[i].id, t.ids[j].id, addDays(today, -80));
  const tls = teams.map((t) => t.ids[0]);
  tls.forEach((t) => befriend(manager.id, t.id, addDays(today, -85)));
  befriend(tls[0].id, tls[1].id, addDays(today, -60));
  befriend(tls[1].id, tls[2].id, addDays(today, -60));
  befriend(teams[0].ids[2].id, teams[1].ids[3].id, addDays(today, -30)); // cross-team friendship
  const admin = get("SELECT id FROM users WHERE role = 'developer' ORDER BY id LIMIT 1");
  if (admin) befriend(admin.id, manager.id, addDays(today, -85));
  // A couple of pending requests for the Connect screen.
  run("INSERT OR IGNORE INTO friendships (requester_id, addressee_id) VALUES (?, ?)", teams[2].ids[3].id, teams[0].ids[2].id);
  run("INSERT OR IGNORE INTO friendships (requester_id, addressee_id) VALUES (?, ?)", teams[1].ids[2].id, teams[0].ids[2].id);

  // 90 days of moods, attendance and logins.
  for (let d = 89; d >= 0; d--) {
    const day = addDays(today, -d);
    const dow = new Date(day + 'T12:00:00').getDay();
    const weekend = dow === 0 || dow === 6;
    for (const p of people) {
      const present = rand() < (weekend ? 0.35 : 0.88);
      if (!present) continue;
      run('INSERT OR IGNORE INTO activity_days (user_id, day) VALUES (?, ?)', p.id, day);
      if (rand() < 0.7) run('INSERT INTO login_logs (user_id, app, created_at) VALUES (?, ?, ?)', p.id, p.role === 'agent' ? 'client' : pick(['client', 'admin']), isoAt(day, 7 + Math.floor(rand() * 3)));
      if (rand() < 0.82) run("INSERT INTO mood_logs (user_id, mood, source, day, created_at) VALUES (?, ?, 'checkin', ?, ?)", p.id, drawMood(PROFILES[p.profile]), day, isoAt(day, 8, Math.floor(rand() * 50)));
      if (rand() < 0.12) run("INSERT INTO mood_logs (user_id, mood, source, day, created_at) VALUES (?, ?, 'note', ?, ?)", p.id, drawMood(PROFILES[p.profile]), day, isoAt(day, 13));
    }
  }

  // Posts, likes, comments over the last 12 days.
  const captions = [
    'Dawn looks relaxing, happy vacation everyone!!', 'Happy RD everyone!!', 'Coffee first, tickets later ☕', 'New personal best on CSAT today 🎉',
    'Team lunch was a vibe 🍜', 'Anyone up for badminton after shift?', 'Reminder: hydrate and stretch 🧘', 'Shoutout to the night shift crew 🌙',
    'Survived a 40-ticket queue. Send snacks.', 'Grateful for this team ❤️', 'Learning something new every day', 'Weekend plans: sleep. That is all.',
  ];
  const postIds = [];
  // Generate then insert oldest-first so ids follow time (the feed orders by id).
  const planned = Array.from({ length: 26 }, () => {
    const day = addDays(today, -Math.floor(rand() * 12));
    return { p: pick(people), day, at: isoAt(day, 9 + Math.floor(rand() * 10)) };
  }).sort((a, b) => a.at.localeCompare(b.at));
  for (const x of planned) {
    const id = Number(run('INSERT INTO posts (user_id, text, created_at) VALUES (?, ?, ?)', x.p.id, pick(captions), x.at).lastInsertRowid);
    postIds.push({ id, author: x.p.id, day: x.day });
  }
  for (const post of postIds) {
    for (const p of people) {
      if (p.id === post.author) continue;
      if (rand() < 0.3) run('INSERT OR IGNORE INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)', post.id, p.id, isoAt(post.day, 20));
      if (rand() < 0.05) run('INSERT INTO comments (post_id, user_id, text, created_at) VALUES (?, ?, ?, ?)', post.id, p.id, pick(['So true!', 'Love this 😍', 'Count me in!', 'Haha same', 'Great job! 👏', 'Rest well!']), isoAt(post.day, 21));
    }
  }

  // Active Mood Stories and notes.
  const themes = ['ocean', 'sunset', 'berry', 'forest', 'aurora', 'peach'];
  const texts = ['Monday mood', 'Shift done ✅', 'Rainy day vibes', 'Ready for the weekend', 'Feeling the flow', 'Need coffee'];
  for (const p of people.filter(() => rand() < 0.4)) {
    const mood = drawMood(PROFILES[p.profile]);
    const created = new Date(Date.now() - rand() * 20 * 3600e3);
    run('INSERT INTO stories (user_id, text, mood, theme, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      p.id, pick(texts), mood, pick(themes), created.toISOString(), new Date(created.getTime() + 24 * 3600e3).toISOString());
  }
  const noteTexts = ['What is your fave snack?', 'Office is cold today 🥶', 'Day 3 of no coffee', 'On leave tomorrow!', 'Gym later?', 'Listening to lo-fi'];
  for (const p of people.filter(() => rand() < 0.5)) {
    const created = new Date(Date.now() - rand() * 12 * 3600e3);
    run('INSERT INTO notes (user_id, text, mood, theme, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      p.id, pick(noteTexts), drawMood(PROFILES[p.profile]), pick(themes), created.toISOString(), new Date(created.getTime() + 24 * 3600e3).toISOString());
  }

  // Conversations: direct chats with daily back-and-forth (streaks) and a team group chat.
  const lines = ['hey!', 'kumusta?', 'all good, busy queue today', 'same 😅', 'lunch later?', 'g!', 'thanks for covering earlier', 'anytime 🙌', 'did you see the new memo?', 'yep, reading now'];
  const direct = (a, b, streakDays) => {
    const key = [a.id, b.id].sort((x, y) => x - y).join(':');
    const cid = Number(run("INSERT INTO conversations (type, direct_key, created_by, created_at) VALUES ('direct', ?, ?, ?)", key, a.id, isoAt(addDays(today, -40), 9)).lastInsertRowid);
    run('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)', cid, a.id, isoAt(addDays(today, -40), 9));
    run('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)', cid, b.id, isoAt(addDays(today, -40), 9));
    let last = 0;
    for (let d = streakDays - 1; d >= 0; d--) {
      const day = addDays(today, -d);
      for (let k = 0; k < 2 + Math.floor(rand() * 3); k++) {
        const from = k % 2 === 0 ? a : b;
        last = Number(run('INSERT INTO messages (conversation_id, sender_id, text, created_at) VALUES (?, ?, ?, ?)', cid, from.id, pick(lines), isoAt(day, 9 + k, k * 7)).lastInsertRowid);
      }
    }
    run('UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ?', last, cid);
    run('UPDATE conversations SET updated_at = ? WHERE id = ?', new Date().toISOString(), cid);
  };
  teams.forEach((t, i) => {
    direct(t.ids[0], t.ids[2], 3 + i * 9);
    direct(t.ids[2], t.ids[3], 2 + i * 4);
    direct(t.ids[1], t.ids[4], 1);
    const cid = Number(run("INSERT INTO conversations (type, name, created_by, created_at) VALUES ('group', ?, ?, ?)", `Team ${t.tl.split(' ')[0]}`, t.ids[0].id, isoAt(addDays(today, -50), 9)).lastInsertRowid);
    t.ids.forEach((m, j) => run('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', cid, m.id, j === 0 ? 'admin' : 'member', isoAt(addDays(today, -50), 9)));
    run("INSERT INTO messages (conversation_id, sender_id, kind, text, created_at) VALUES (?, ?, 'system', ?, ?)", cid, t.ids[0].id, `${t.tl} created the group "Team ${t.tl.split(' ')[0]}"`, isoAt(addDays(today, -50), 9));
    for (let d = 6; d >= 0; d--) {
      for (let k = 0; k < 3; k++) {
        run('INSERT INTO messages (conversation_id, sender_id, text, created_at) VALUES (?, ?, ?, ?)', cid, pick(t.ids).id, pick(['Good morning team ☀️', 'Queue is spiking, all hands!', 'Huddle in 5', 'Great work today everyone 👏', 'Reminder to log your mood 😊', 'Who has the latest KB article?']), isoAt(addDays(today, -d), 8 + k * 3));
      }
    }
    const pin = get('SELECT id FROM messages WHERE conversation_id = ? AND kind = ? ORDER BY id DESC LIMIT 1', cid, 'text');
    run('UPDATE messages SET pinned = 1, pinned_by = ? WHERE id = ?', t.ids[0].id, pin.id);
    run('UPDATE conversations SET updated_at = ? WHERE id = ?', new Date().toISOString(), cid);
  });

  // Email templates.
  const tpl = [['Weekly check-in', 'Weekly mood check-in', 'Hi team,\n\nPlease take a minute to log your mood in Hunch today. Your feedback helps us support you better.\n\nThanks!'],
    ['Welcome aboard', 'Welcome to Hunch!', 'Hi,\n\nWelcome to Hunch! Sign in with the email and temporary password provided by your administrator, then verify your account and set a new password.\n\nSee you inside!']];
  tpl.forEach(([n, s, b]) => run('INSERT INTO email_templates (name, subject, body, created_by) VALUES (?, ?, ?, ?)', n, s, b, manager.id));
});

console.log(`Demo data created: ${people.length} users. All demo passwords: ${PASSWORD}`);
console.log('Examples:');
for (const p of people.slice(0, 3)) console.log(`  ${p.role.padEnd(8)} ${p.email}${p.username ? `  (dashboard username: ${p.username})` : ''}`);
console.log(`  agent    ${people.find((p) => p.role === 'agent').email}`);
db.close();
