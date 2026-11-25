import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { get, run, DATA_DIR } from './db.js';
import { localDay, nowIso } from './util.js';
import { isStaffRole } from '../../shared/constants.js';

export const isStaff = (u) => isStaffRole(u?.role);

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
  // The Admin Dashboard is for Hunch staff only.
  if (payload.app === 'admin' && !isStaff(user)) return res.status(403).json({ error: 'No admin access.' });
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

// ---------- RBAC (Admin Dashboard, staff only) ----------
// Developers and System Administrators run the whole platform. Hunch Employees, Customer Support and Operations
// get the modules their job needs. Regular users have no modules: they never reach the dashboard.
export const MODULES = {
  developer: ['stats', 'reports', 'teams', 'notifications', 'email', 'users', 'admins', 'settings', 'register'],
  sysadmin: ['stats', 'reports', 'teams', 'notifications', 'email', 'users', 'admins', 'settings', 'register'],
  employee: ['stats', 'reports', 'teams', 'notifications', 'email', 'users'],
  support: ['reports', 'notifications', 'email', 'users'],
  operations: ['stats', 'reports', 'teams', 'notifications', 'email'],
};
export const modulesFor = (u) => (isStaff(u) ? [...(MODULES[u.role] || [])] : []);
const STAFF_ROLES_ALL = ['developer', 'sysadmin', 'employee', 'support', 'operations'];
const MEMBER_ROLES = ['user', 'manager', 'tl', 'sme', 'agent'];
/** Staff accounts are created in Registration; regular users sign up themselves. */
export const creatableRoles = (u) =>
  u.role === 'developer' ? STAFF_ROLES_ALL : u.role === 'sysadmin' ? STAFF_ROLES_ALL.filter((r) => r !== 'developer') : [];
/** Accounts a staff member may edit in User Management (status, password resets, role). */
export const manageableRoles = (u) => {
  if (u.role === 'developer') return [...STAFF_ROLES_ALL, ...MEMBER_ROLES];
  if (u.role === 'sysadmin') return [...STAFF_ROLES_ALL.filter((r) => r !== 'developer'), ...MEMBER_ROLES];
  if (['employee', 'support'].includes(u.role)) return MEMBER_ROLES;
  return [];
};
/** Roles a staff member may give someone. Support staff can't promote anyone to staff. */
export const assignableRoles = (u) => (['developer', 'sysadmin'].includes(u.role) ? [...creatableRoles(u), 'user'] : ['user']);
// Platform staff see every team's aggregate numbers; there is no per-team scope any more.
export const teamScope = () => null;
export const requireModule = (mod) => (req, res, next) =>
  modulesFor(req.user).includes(mod) ? next() : res.status(403).json({ error: 'You do not have access to this module.' });
