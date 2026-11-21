import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { get, run, DATA_DIR } from './db.js';
import { localDay, nowIso } from './util.js';

// Persist a random secret so tokens survive restarts without hard-coding one.
const secretFile = path.join(DATA_DIR, '.jwt-secret');
if (!process.env.JWT_SECRET && !fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(48).toString('hex'));
export const JWT_SECRET = process.env.JWT_SECRET || fs.readFileSync(secretFile, 'utf8').trim();

// Remember me keeps the session for 30 days; otherwise 12 hours.
export const signToken = (user, app, remember = false) => jwt.sign({ sub: user.id, app }, JWT_SECRET, { expiresIn: remember ? '30d' : '12h' });

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

const touched = new Map();
function touch(user) {
  const t = Date.now();
  if (t - (touched.get(user.id) || 0) < 60e3) return;
  touched.set(user.id, t);
  run('UPDATE users SET last_active_at = ? WHERE id = ?', nowIso(), user.id);
  run('INSERT OR IGNORE INTO activity_days (user_id, day) VALUES (?, ?)', user.id, localDay());
}

/**
 * Authenticate a request.
 * ready=true (default) also requires the account to have finished onboarding:
 * password changed and (for the client app) email verified.
 */
export const auth = ({ ready = true, app = null } = {}) => (req, res, next) => {
  const hdr = req.headers.authorization || '';
  const payload = verifyToken(hdr.startsWith('Bearer ') ? hdr.slice(7) : '');
  if (!payload) return res.status(401).json({ error: 'Please sign in.' });
  if (app && payload.app !== app) return res.status(403).json({ error: 'Wrong application for this session.' });
  const user = get('SELECT * FROM users WHERE id = ?', payload.sub);
  if (!user || user.status !== 'active') return res.status(401).json({ error: 'Account is not active.' });
  if (payload.app === 'admin' && user.role === 'agent') return res.status(403).json({ error: 'No admin access.' });
  if (ready) {
    if (user.must_change_password) return res.status(428).json({ error: 'Password change required.', code: 'CHANGE_PASSWORD' });
    if (!user.verified) return res.status(428).json({ error: 'Account verification required.', code: 'VERIFY' });
    if (!user.profile_completed) return res.status(428).json({ error: 'Complete your profile to continue.', code: 'PROFILE' });
  }
  req.user = user;
  req.app_kind = payload.app;
  touch(user);
  next();
};

// ---------- RBAC ----------
export const MODULES = {
  developer: ['stats', 'reports', 'workspace', 'notifications', 'email', 'users', 'admins', 'settings', 'register'],
  manager: ['stats', 'reports', 'workspace', 'notifications', 'email', 'users', 'register'],
  tl: ['stats', 'reports', 'workspace', 'notifications', 'email'],
  sme: ['stats', 'reports', 'workspace', 'notifications', 'email'],
  agent: [],
};
export const modulesFor = (u) => {
  const m = [...(MODULES[u.role] || [])];
  if ((u.role === 'tl' || u.role === 'sme') && u.can_create_accounts) m.push('register');
  return m;
};
export const creatableRoles = (u) => {
  if (u.role === 'developer') return ['agent', 'sme', 'tl', 'manager', 'developer'];
  if (u.role === 'manager') return ['agent', 'sme', 'tl'];
  if ((u.role === 'tl' || u.role === 'sme') && u.can_create_accounts) return ['agent'];
  return [];
};
// Roles a user may edit in User Management.
export const manageableRoles = (u) =>
  u.role === 'developer' ? ['agent', 'sme', 'tl', 'manager', 'developer'] : u.role === 'manager' ? ['agent', 'sme', 'tl'] : [];
// Team scope: TLs see their own team, SMEs see the team of their TL. null = everything.
export const teamScope = (u) => (u.role === 'tl' ? u.id : u.role === 'sme' ? u.team_leader_id || -1 : null);
export const requireModule = (mod) => (req, res, next) =>
  modulesFor(req.user).includes(mod) ? next() : res.status(403).json({ error: 'You do not have access to this module.' });
