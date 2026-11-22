import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, '../data');
export const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.resolve(__dirname, '../uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'hunch.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_code TEXT UNIQUE,
  username TEXT UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('developer','manager','tl','sme','agent')),
  avatar TEXT,
  cover TEXT,
  bio TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  privacy TEXT NOT NULL DEFAULT 'public' CHECK (privacy IN ('public','friends')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  team_leader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  can_create_accounts INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  verified INTEGER NOT NULL DEFAULT 0,
  verify_code TEXT,
  verify_expires TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  last_login_at TEXT,
  last_active_at TEXT
);
CREATE TABLE IF NOT EXISTS login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS activity_days (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS mood_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mood TEXT NOT NULL,
  source TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_mood_day ON mood_logs(day);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  repost_of INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS post_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS likes (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  image TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  image TEXT,
  mood TEXT,
  theme TEXT NOT NULL DEFAULT 'midnight',
  created_at TEXT NOT NULL DEFAULT ${NOW},
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS story_views (
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (story_id, user_id)
);
CREATE TABLE IF NOT EXISTS highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS highlight_items (
  highlight_id INTEGER NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (highlight_id, story_id)
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  mood TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT 'midnight',
  created_at TEXT NOT NULL DEFAULT ${NOW},
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
  created_at TEXT NOT NULL DEFAULT ${NOW},
  accepted_at TEXT,
  UNIQUE (requester_id, addressee_id)
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('direct','group')),
  name TEXT,
  photo TEXT,
  direct_key TEXT UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  last_read_id INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','system')),
  text TEXT NOT NULL DEFAULT '',
  image TEXT,
  shared_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  pinned_by INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audience TEXT NOT NULL DEFAULT 'client' CHECK (audience IN ('client','admin')),
  type TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  entity_type TEXT,
  entity_id INTEGER,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  data TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, audience, id);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'announcement' CHECK (kind IN ('announcement','app_update')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'everyone',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS account_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  requested_role TEXT NOT NULL DEFAULT 'agent',
  team_leader TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved')),
  handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder TEXT NOT NULL CHECK (folder IN ('inbox','sent','drafts','scheduled','trash')),
  from_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  from_email TEXT NOT NULL,
  to_list TEXT NOT NULL DEFAULT '[]',
  cc_list TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  attachments TEXT NOT NULL DEFAULT '[]',
  template_id INTEGER,
  scheduled_at TEXT,
  sent_at TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  external TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_email_owner ON emails(owner_id, folder);
CREATE TABLE IF NOT EXISTS email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// ---------- migrations ----------
const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!cols.includes('profile_completed')) {
  db.exec('ALTER TABLE users ADD COLUMN profile_completed INTEGER NOT NULL DEFAULT 0');
  // Existing users who already finished onboarding keep access.
  db.exec('UPDATE users SET profile_completed = 1 WHERE must_change_password = 0 AND verified = 1');
}

const addColumn = (table, col, def) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
addColumn('users', 'settings', "TEXT NOT NULL DEFAULT '{}'");
addColumn('conversations', 'description', "TEXT NOT NULL DEFAULT ''");
addColumn('conversation_members', 'muted', 'INTEGER NOT NULL DEFAULT 0');
addColumn('conversation_members', 'archived', 'INTEGER NOT NULL DEFAULT 0');
addColumn('messages', 'attachment', 'TEXT');
addColumn('messages', 'story_id', 'INTEGER REFERENCES stories(id) ON DELETE SET NULL');
addColumn('stories', 'allow_comments', 'INTEGER NOT NULL DEFAULT 0');
addColumn('comments', 'mentions', "TEXT NOT NULL DEFAULT '[]'");
db.exec(`
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS comment_reactions (
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);
CREATE TABLE IF NOT EXISTS story_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER,
  subject TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
`);

// ---------- v0.3: map, highlights, workspace ----------
addColumn('stories', 'place_name', 'TEXT');
addColumn('stories', 'lat', 'REAL');
addColumn('stories', 'lng', 'REAL');
addColumn('highlights', 'cover_image', 'TEXT');
addColumn('highlights', 'cover_emoji', 'TEXT');
addColumn('highlights', 'shares', 'INTEGER NOT NULL DEFAULT 0');
addColumn('messages', 'highlight_id', 'INTEGER REFERENCES highlights(id) ON DELETE SET NULL');
// Work posts live in the posts table, scoped to a team (team_id = the team leader's user id).
addColumn('posts', 'team_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE');
addColumn('posts', 'kind', "TEXT NOT NULL DEFAULT 'post'");
addColumn('posts', 'pinned', 'INTEGER NOT NULL DEFAULT 0');
db.exec(`
CREATE INDEX IF NOT EXISTS idx_posts_team ON posts(team_id, id);
CREATE TABLE IF NOT EXISTS saved_posts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (user_id, post_id)
);
CREATE TABLE IF NOT EXISTS highlight_likes (
  highlight_id INTEGER NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (highlight_id, user_id)
);
CREATE TABLE IF NOT EXISTS highlight_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  highlight_id INTEGER NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS highlight_views (
  highlight_id INTEGER NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  views INTEGER NOT NULL DEFAULT 1,
  last_viewed_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (highlight_id, user_id)
);
CREATE TABLE IF NOT EXISTS user_locations (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  place_name TEXT,
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('walk','motorcycle','car')),
  origin_name TEXT, origin_lat REAL NOT NULL, origin_lng REAL NOT NULL,
  dest_name TEXT, dest_lat REAL NOT NULL, dest_lng REAL NOT NULL,
  route TEXT NOT NULL,
  route_source TEXT NOT NULL,
  distance_m REAL NOT NULL,
  duration_s REAL NOT NULL,
  cur_lat REAL, cur_lng REAL,
  remaining_m REAL, eta_s REAL,
  shared INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','arrived','ended')),
  started_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS team_settings (
  team_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  members_can_post INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS post_permissions (
  team_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  note TEXT NOT NULL DEFAULT '',
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  decided_at TEXT,
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('shift','rest','lunch','meeting','overtime','coaching','training')),
  title TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_sched_team_day ON schedules(team_id, day);
`);

// ---------- v0.4: notes stickers, bubble colours, likes, replies ----------
addColumn('notes', 'emoji', 'TEXT');
addColumn('notes', 'color', 'TEXT');
addColumn('messages', 'note_ref', 'TEXT');
db.exec(`
CREATE TABLE IF NOT EXISTS note_likes (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (note_id, user_id)
);`);

// ---------- v0.6: story audiences, interactions, music, stickers ----------
addColumn('stories', 'audience', "TEXT NOT NULL DEFAULT 'friends'");
addColumn('stories', 'team_id', 'INTEGER');
addColumn('stories', 'allow_replies', 'INTEGER NOT NULL DEFAULT 1');
addColumn('stories', 'allow_reactions', 'INTEGER NOT NULL DEFAULT 1');
addColumn('stories', 'allow_sharing', 'INTEGER NOT NULL DEFAULT 1');
addColumn('stories', 'show_on_map', 'INTEGER NOT NULL DEFAULT 1');
addColumn('stories', 'archive', 'INTEGER NOT NULL DEFAULT 1');
addColumn('stories', 'music', 'TEXT');
addColumn('stories', 'stickers', "TEXT NOT NULL DEFAULT '[]'");
db.exec(`
CREATE TABLE IF NOT EXISTS close_friends (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, friend_id)
);
CREATE TABLE IF NOT EXISTS story_poll_votes (
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option INTEGER NOT NULL,
  PRIMARY KEY (story_id, user_id)
);`);

// Per-user preferences (privacy, notifications, media). Stored as JSON on users.settings.
export const DEFAULT_USER_SETTINGS = {
  message_privacy: 'friends', // friends | nobody
  friend_requests: 'everyone', // everyone | mutuals | nobody
  show_active: true,
  media_autoload: true,
  location_sharing: 'private', // friends | private — covers current location, story locations and trips
  notify: { likes: true, comments: true, messages: true, friend_requests: true, app_updates: true, work: true, trips: true },
};
export function userSettings(uid) {
  let s = {};
  try { s = JSON.parse(db.prepare('SELECT settings FROM users WHERE id = ?').get(uid)?.settings || '{}'); } catch { /* default */ }
  return { ...DEFAULT_USER_SETTINGS, ...s, notify: { ...DEFAULT_USER_SETTINGS.notify, ...(s.notify || {}) } };
}

// ---------- query helpers ----------
const cache = new Map();
const stmt = (sql) => {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
};
const clean = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
export const get = (sql, ...p) => {
  const r = stmt(sql).get(...clean(p));
  return r ? { ...r } : undefined;
};
export const all = (sql, ...p) => stmt(sql).all(...clean(p)).map((r) => ({ ...r }));
export const run = (sql, ...p) => stmt(sql).run(...clean(p));
export const tx = (fn) => {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};

// ---------- settings ----------
export const DEFAULT_SETTINGS = {
  app_name: 'Hunch',
  story_hours: '24',
  note_hours: '24',
  note_max_words: '35',
  active_window_days: '7',
  daily_report_hour: '18',
  allow_account_requests: '1',
  maintenance_banner: '',
  last_daily_report: '',
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  run('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)', k, v);
}
export const getSetting = (k) => get('SELECT value FROM settings WHERE key = ?', k)?.value ?? DEFAULT_SETTINGS[k];
export const setSetting = (k, v) => run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(v));

// ---------- seed initial admin ----------
export const codeFor = (id) => 'HN' + String(100000 + id);
// First run only (empty database): create one developer account from the environment.
// No credentials are stored in the code. If INITIAL_ADMIN_PASSWORD is not set, a random one is
// generated and printed once to the server log. The account must change its password on first sign-in.
if (!get("SELECT id FROM users WHERE role = 'developer' LIMIT 1")) {
  const username = process.env.INITIAL_ADMIN_USERNAME || 'admin';
  const email = (process.env.INITIAL_ADMIN_EMAIL || 'admin@hunch.local').toLowerCase();
  const generated = !process.env.INITIAL_ADMIN_PASSWORD;
  const password = process.env.INITIAL_ADMIN_PASSWORD || `Hn-${crypto.randomBytes(9).toString('base64url')}`;
  const r = run(
    `INSERT INTO users (username, email, password_hash, full_name, role, must_change_password, verified, job_title)
     VALUES (?, ?, ?, ?, 'developer', 1, 1, 'System Developer')`,
    username, email, bcrypt.hashSync(password, 10), process.env.INITIAL_ADMIN_NAME || 'Hunch Admin'
  );
  run('UPDATE users SET user_code = ? WHERE id = ?', codeFor(Number(r.lastInsertRowid)), Number(r.lastInsertRowid));
  console.log(`[hunch] Created the first developer account "${username}".${generated ? ` Temporary password: ${password}  (shown once; change it on first sign-in)` : ''}`);
}

// Admin recovery (locked out of production): set ADMIN_RECOVERY=1 together with INITIAL_ADMIN_EMAIL and
// INITIAL_ADMIN_PASSWORD on the host, then redeploy. That account is reset (or created) as an active developer
// with that password, and must change it at sign-in. Remove ADMIN_RECOVERY again right after.
if (process.env.ADMIN_RECOVERY === '1') {
  const email = String(process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD || '';
  if (!email || password.length < 8) {
    console.warn('[hunch] ADMIN_RECOVERY is set but INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD (8+ chars) are missing. Nothing changed.');
  } else {
    const username = process.env.INITIAL_ADMIN_USERNAME || null;
    const existing = get('SELECT id FROM users WHERE email = ? OR (username IS NOT NULL AND username = ?)', email, username);
    if (existing) {
      run(`UPDATE users SET password_hash = ?, role = 'developer', status = 'active', must_change_password = 1, verified = 1 WHERE id = ?`,
        bcrypt.hashSync(password, 10), existing.id);
      console.log(`[hunch] ADMIN_RECOVERY: reset the password for ${email}. Remove ADMIN_RECOVERY from the host now.`);
    } else {
      const r = run(
        `INSERT INTO users (username, email, password_hash, full_name, role, must_change_password, verified, job_title)
         VALUES (?, ?, ?, ?, 'developer', 1, 1, 'System Developer')`,
        username, email, bcrypt.hashSync(password, 10), process.env.INITIAL_ADMIN_NAME || 'Hunch Admin'
      );
      run('UPDATE users SET user_code = ? WHERE id = ?', codeFor(Number(r.lastInsertRowid)), Number(r.lastInsertRowid));
      console.log(`[hunch] ADMIN_RECOVERY: created developer account ${email}. Remove ADMIN_RECOVERY from the host now.`);
    }
  }
}

// ---------- v0.5: named teams ----------
// A team still belongs to its team leader: members link to it through users.team_leader_id, and the Work feed,
// schedules and reports key on the TL's id. This table adds the team's own details on top.
db.exec(`
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  tl_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  sme_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#5B8DEF',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
`);
// Once: give every existing team leader a named team, so current teams keep working.
if (getSetting('teams_migrated') !== '1') {
  tx(() => {
    for (const tl of all("SELECT id, full_name, created_at FROM users WHERE role = 'tl' AND id NOT IN (SELECT tl_id FROM teams WHERE tl_id IS NOT NULL)")) {
      const sme = get("SELECT id FROM users WHERE role = 'sme' AND team_leader_id = ? ORDER BY id LIMIT 1", tl.id);
      run('INSERT INTO teams (name, tl_id, sme_id, created_at) VALUES (?, ?, ?, ?)', `Team ${tl.full_name.split(' ')[0]}`, tl.id, sme?.id ?? null, tl.created_at);
    }
    setSetting('teams_migrated', '1');
  });
}
