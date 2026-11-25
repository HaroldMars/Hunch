import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { get, all, run, tx, getSetting, codeFor } from '../db.js';
import { auth, signToken, modulesFor, creatableRoles, isStaff } from '../auth.js';
import { h, fail, nowIso, validatePassword, selfUser, imageUpload, fileUrl, deleteStoredFiles, localDay, addDays } from '../util.js';
import { MOODS, INTERESTS } from '../../../shared/constants.js';
import { notifyStaff } from '../notify.js';
import { sendVerificationCode } from '../mailer.js';

const r = Router();
// App version: APP_VERSION env, else the project's package.json, else the backend's (the Docker image only has backend/).
const readVersion = (rel) => { try { return JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8')).version; } catch { return null; } };
const APP_VERSION = process.env.APP_VERSION || readVersion('../../../package.json') || readVersion('../../package.json') || '0.0.0';

const attempts = new Map(); // simple brute-force guard: key -> {n, until}
function guard(key) {
  const a = attempts.get(key);
  if (a && a.until > Date.now()) fail(429, 'Too many attempts. Try again in a few minutes.');
}
function recordFail(key) {
  const a = attempts.get(key) || { n: 0, until: 0 };
  a.n += 1;
  if (a.n >= 8) {
    a.until = Date.now() + 5 * 60e3;
    a.n = 0;
  }
  attempts.set(key, a);
}

export const nextStep = (user) =>
  !user.verified ? 'verify' : user.must_change_password ? 'change-password' : !user.profile_completed ? 'complete-profile' : null;

export const sessionPayload = (user, app) => ({
  user: selfUser(user),
  app,
  modules: modulesFor(user),
  creatableRoles: creatableRoles(user),
  // First login: verify email → create a new password → complete profile.
  next: nextStep(user),
  // The onboarding steps this account goes through: staff-created accounts get all three,
  // email sign-ups verify their email, Google sign-ups only complete their profile.
  steps: user.signup_method === 'google' ? ['complete-profile'] : user.signup_method === 'email' ? ['verify', 'complete-profile'] : ['verify', 'change-password', 'complete-profile'],
});

// Destination: the app you signed in to. The Admin Dashboard is for Hunch staff only, so anyone else
// signing in there is sent to the Hunch app. ('auto' = old clients: staff → dashboard, everyone else → app.)
const resolveApp = (requested, user) => (requested === 'client' || requested === 'admin' ? requested : isStaff(user) ? 'admin' : 'client');

function completeLogin(res, user, app, remember) {
  if (user.status !== 'active') fail(403, 'This account has been deactivated. Contact your administrator.');
  if (app === 'admin' && !isStaff(user)) app = 'client';
  run('UPDATE users SET last_login_at = ?, last_active_at = ? WHERE id = ?', nowIso(), nowIso(), user.id);
  run('INSERT INTO login_logs (user_id, app) VALUES (?, ?)', user.id, app);
  res.json({ token: signToken(user, app, remember), ...sessionPayload(user, app) });
}

r.post('/login', h((req, res) => {
  const { identifier = '', password = '', app = 'auto', remember = false } = req.body || {};
  const id = String(identifier).trim();
  if (!id || !password) fail(400, 'Enter your email and password.');
  const key = `login:${id.toLowerCase()}`;
  guard(key);
  const user = get('SELECT * FROM users WHERE email = ? OR username = ?', id, id);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordFail(key);
    fail(401, 'Incorrect email or password.');
  }
  attempts.delete(key);
  completeLogin(res, user, resolveApp(app, user), !!remember);
}));

// ---------- self sign-up ----------
const USERNAME = /^[a-z0-9._]{3,30}$/i;
const checkUsername = (name, exceptId = 0) => {
  const u = String(name || '').trim().replace(/^@/, '');
  if (!USERNAME.test(u)) fail(400, 'Usernames are 3–30 characters: letters, numbers, dots and underscores.');
  if (get('SELECT id FROM users WHERE username = ? AND id != ?', u, exceptId)) fail(409, 'That username is taken. Try another.');
  return u;
};
/** A free username based on a name or email, for Google sign-ups (they can change it in the next step). */
function suggestUsername(seed) {
  const base = (String(seed || 'hunch').toLowerCase().replace(/[^a-z0-9._]/g, '').replace(/^[._]+|[._]+$/g, '') || 'hunch').slice(0, 24).padEnd(3, '0');
  for (let i = 0; i < 50; i++) {
    const name = i ? `${base}${crypto.randomInt(10, 9999)}` : base;
    if (!get('SELECT id FROM users WHERE username = ?', name)) return name;
  }
  return `user${Date.now().toString(36)}`;
}
function createMember({ full_name, email, username, password, method, avatar = null, verified = 0 }) {
  return tx(() => {
    const id = Number(run(
      `INSERT INTO users (username, email, password_hash, full_name, role, avatar, must_change_password, verified, profile_completed, signup_method, job_title)
       VALUES (?, ?, ?, ?, 'user', ?, 0, ?, 0, ?, '')`,
      username, email, bcrypt.hashSync(password, 10), full_name, avatar, verified, method
    ).lastInsertRowid);
    run('UPDATE users SET user_code = ? WHERE id = ?', codeFor(id), id);
    return get('SELECT * FROM users WHERE id = ?', id);
  });
}

// Anyone can create a Hunch account. They verify their email, then complete their profile.
r.post('/signup', h((req, res) => {
  const { full_name = '', email = '', username = '', password = '', remember = true } = req.body || {};
  const name = String(full_name).trim().slice(0, 80);
  const mail = String(email).trim().toLowerCase();
  if (!name) fail(400, 'Enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) fail(400, 'Enter a valid email address.');
  const uname = checkUsername(username);
  const err = validatePassword(password);
  if (err) fail(400, err);
  if (get('SELECT id FROM users WHERE email = ?', mail)) fail(409, 'An account with this email already exists. Sign in instead.');
  const user = createMember({ full_name: name, email: mail, username: uname, password, method: 'email' });
  completeLogin(res, user, 'client', !!remember);
}));

// Continue with Google: signs in an existing account, or creates one for a new person (Hunch app only).
// Name, email and profile photo come from Google; username, bio and interests are asked next.
r.post('/google', h(async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) fail(501, 'Google sign-in is not configured on this server.');
  const { credential = '', app = 'auto', remember = false } = req.body || {};
  const g = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`).then((x) => x.json()).catch(() => null);
  if (!g || g.aud !== clientId || g.email_verified !== 'true') fail(401, 'Google sign-in failed. Try again.');
  const email = String(g.email).toLowerCase();
  let user = get('SELECT * FROM users WHERE email = ?', email);
  if (!user) {
    if (app === 'admin') fail(403, 'No Hunch staff account uses this Google email.');
    const avatar = /^https:\/\/[\w.-]+\.googleusercontent\.com\//.test(g.picture || '') ? g.picture : null;
    user = createMember({
      full_name: String(g.name || email.split('@')[0]).slice(0, 80), email, username: suggestUsername(email.split('@')[0]),
      password: crypto.randomBytes(24).toString('hex'), method: 'google', avatar, verified: 1,
    });
  } else if (!user.verified) {
    // Google has confirmed this email address.
    run('UPDATE users SET verified = 1, verify_code = NULL WHERE id = ?', user.id);
    user = get('SELECT * FROM users WHERE id = ?', user.id);
  }
  completeLogin(res, user, resolveApp(app, user), !!remember);
}));

// Hand a signed-in user over to the other app (e.g. a TL opening the social app).
r.post('/handoff', auth(), h((req, res) => {
  const app = req.body?.app === 'admin' ? 'admin' : 'client';
  if (app === 'admin' && !isStaff(req.user)) fail(403, 'No admin access.');
  res.json({ token: signToken(req.user, app, false), app });
}));

r.get('/me', auth({ ready: false }), h((req, res) => {
  res.json(sessionPayload(req.user, req.app_kind));
}));

r.post('/change-password', auth({ ready: false }), h((req, res) => {
  const { currentPassword = '', newPassword = '' } = req.body || {};
  const u = req.user;
  // On a temporary password the user just authenticated with it, so the current password is not asked again.
  if (!u.must_change_password && !bcrypt.compareSync(currentPassword, u.password_hash)) fail(400, 'Current password is incorrect.');
  const err = validatePassword(newPassword);
  if (err) fail(400, err);
  if (bcrypt.compareSync(newPassword, u.password_hash)) fail(400, 'Choose a password different from your temporary one.');
  run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', bcrypt.hashSync(newPassword, 10), u.id);
  const fresh = get('SELECT * FROM users WHERE id = ?', u.id);
  res.json(sessionPayload(fresh, req.app_kind));
}));

// Email verification. The code is emailed when SMTP is configured; in development it is also
// printed to the server console and returned as `devCode` for testing.
r.post('/verify/send', auth({ ready: false }), h(async (req, res) => {
  const code = String(crypto.randomInt(100000, 999999));
  run('UPDATE users SET verify_code = ?, verify_expires = ? WHERE id = ?', code, new Date(Date.now() + 15 * 60e3).toISOString(), req.user.id);
  const emailed = await sendVerificationCode(req.user.email, req.user.full_name.split(' ')[0], code);
  if (process.env.NODE_ENV !== 'production') console.log(`[hunch] Verification code for ${req.user.email}: ${code}${emailed ? ' (also emailed)' : ''}`);
  res.json({ sentTo: req.user.email, emailed, devCode: process.env.NODE_ENV === 'production' ? undefined : code });
}));

r.post('/verify', auth({ ready: false }), h((req, res) => {
  const { code = '' } = req.body || {};
  const u = req.user;
  if (!u.verify_code || u.verify_code !== String(code).trim()) fail(400, 'That code is not correct.');
  if (new Date(u.verify_expires) < new Date()) fail(400, 'That code has expired. Send a new one.');
  run('UPDATE users SET verified = 1, verify_code = NULL, verify_expires = NULL WHERE id = ?', u.id);
  res.json(sessionPayload(get('SELECT * FROM users WHERE id = ?', u.id), req.app_kind));
}));

// Forgot password: files a reset request that staff resolve from User Management.
r.post('/forgot', h((req, res) => {
  const id = String(req.body?.identifier || '').trim();
  if (!id) fail(400, 'Enter your email or username.');
  const user = get('SELECT id, full_name, email FROM users WHERE email = ? OR username = ?', id, id);
  if (user && !get("SELECT id FROM password_reset_requests WHERE user_id = ? AND status = 'pending'", user.id)) {
    const rr = run('INSERT INTO password_reset_requests (user_id) VALUES (?)', user.id);
    notifyStaff({
      type: 'password_reset', actorId: user.id, entityType: 'password_reset', entityId: Number(rr.lastInsertRowid),
      title: 'Password reset request', body: `${user.full_name} (${user.email}) requested a password reset.`,
    });
  }
  // Same response whether or not the account exists.
  res.json({ ok: true, message: 'If that account exists, an administrator has been notified to reset your password.' });
}));

r.post('/account-request', h((req, res) => {
  if (getSetting('allow_account_requests') !== '1') fail(403, 'Account requests are currently closed.');
  const { full_name = '', email = '', requested_role = 'agent', team_leader = '', message = '' } = req.body || {};
  if (!full_name.trim() || !/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Enter your full name and a valid email.');
  if (!['agent', 'sme', 'tl'].includes(requested_role)) fail(400, 'Invalid role.');
  if (get('SELECT id FROM users WHERE email = ?', email)) fail(409, 'An account with this email already exists.');
  if (get("SELECT id FROM account_requests WHERE email = ? AND status = 'pending'", email)) fail(409, 'A request for this email is already pending.');
  const rr = run(
    'INSERT INTO account_requests (full_name, email, requested_role, team_leader, message) VALUES (?, ?, ?, ?, ?)',
    full_name.trim(), email.trim(), requested_role, team_leader.trim().slice(0, 100), message.trim().slice(0, 500)
  );
  notifyStaff({
    type: 'account_request', entityType: 'account_request', entityId: Number(rr.lastInsertRowid),
    title: 'New account request', body: `${full_name.trim()} (${email.trim()}) requested a ${requested_role.toUpperCase()} account.`,
  });
  res.json({ ok: true });
}));

// Live username check for the sign-up and profile forms.
r.get('/username-available', h((req, res) => {
  const u = String(req.query.u || '').trim().replace(/^@/, '');
  if (!USERNAME.test(u)) return res.json({ ok: false, reason: '3–30 letters, numbers, dots or underscores' });
  const taken = get('SELECT id FROM users WHERE username = ?', u);
  res.json({ ok: !taken, reason: taken ? 'Taken' : null });
}));

r.get('/public-settings', h((_req, res) => {
  res.json({
    app_name: getSetting('app_name'),
    allow_account_requests: getSetting('allow_account_requests') === '1',
    allow_signup: true,
    maintenance_banner: getSetting('maintenance_banner'),
    note_max_words: Number(getSetting('note_max_words')),
    google_client_id: process.env.GOOGLE_CLIENT_ID || null,
    app_version: APP_VERSION,
  });
}));

/** Interests: a JSON array or comma list, limited to the known options. */
export const readInterests = (v) => {
  let list = v;
  if (typeof v === 'string') { try { list = JSON.parse(v); } catch { list = v.split(','); } }
  return [...new Set([].concat(list || []).map((x) => String(x).trim()).filter((x) => INTERESTS.includes(x)))].slice(0, 10);
};

// Final onboarding step: name, username, bio and interests (photo optional).
r.post('/complete-profile', auth({ ready: false }), imageUpload.single('avatar'), h((req, res) => {
  const u = req.user;
  if (!u.verified || u.must_change_password) fail(400, 'Finish the earlier steps first.');
  const b = req.body || {};
  const full_name = String(b.full_name ?? u.full_name).trim().slice(0, 80);
  if (!full_name) fail(400, 'Your name is required.');
  const username = b.username !== undefined ? checkUsername(b.username, u.id) : u.username;
  if (!username && !isStaff(u)) fail(400, 'Choose a username.');
  const interests = b.interests !== undefined ? JSON.stringify(readInterests(b.interests)) : u.interests;
  run('UPDATE users SET full_name = ?, username = ?, job_title = ?, bio = ?, location = ?, interests = ?, avatar = COALESCE(?, avatar), profile_completed = 1 WHERE id = ?',
    full_name, username, String(b.job_title ?? u.job_title).slice(0, 80), String(b.bio ?? u.bio).slice(0, 300), String(b.location ?? u.location).slice(0, 80),
    interests, fileUrl(req.file), u.id);
  if (req.file) deleteStoredFiles(u.avatar);
  res.json(sessionPayload(get('SELECT * FROM users WHERE id = ?', u.id), req.app_kind));
}));

// Public, aggregate-only snapshot for the sign-in screen. Falls back to 7 days when today is quiet.
r.get('/community-mood', h((_req, res) => {
  const today = localDay();
  let rows = all('SELECT mood, COUNT(*) c FROM mood_logs WHERE day = ? GROUP BY mood', today);
  let period = 'today';
  if (rows.reduce((a, x) => a + x.c, 0) < 5) {
    rows = all('SELECT mood, COUNT(*) c FROM mood_logs WHERE day BETWEEN ? AND ? GROUP BY mood', addDays(today, -6), today);
    period = 'week';
  }
  const total = rows.reduce((a, x) => a + x.c, 0);
  const top = rows.sort((a, b) => b.c - a.c).slice(0, 4).map((x) => {
    const m = MOODS.find((k) => k.key === x.mood);
    return { mood: x.mood, label: m?.label, emoji: m?.emoji, pct: Math.round((x.c / total) * 100) };
  });
  res.json({ period, total, top });
}));

export default r;
