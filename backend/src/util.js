import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { get, all, UPLOAD_DIR } from './db.js';
import { CLOUDINARY, cloudinaryEnabled, API_URL } from './config.js';

export const nowIso = () => new Date().toISOString();
export const localDay = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + n));
};
export const hoursFromNow = (h) => new Date(Date.now() + h * 3600e3).toISOString();

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, message) => {
  throw new HttpError(status, message);
};
// Express 4 does not catch async errors; wrap every handler.
export const h = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (e) {
    next(e);
  }
};

export const randomPassword = () => {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  const bytes = crypto.randomBytes(10);
  for (const b of bytes) s += alpha[b % alpha.length];
  return `Hn-${s.slice(0, 5)}-${s.slice(5)}`;
};
export const validatePassword = (p) => {
  if (!p || p.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Password must include letters and numbers.';
  return null;
};

// ---------- uploads ----------
const diskStorage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
    cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});
// Production: stream uploads straight to Cloudinary (signed server-side, so the API secret never
// reaches a browser) and keep only the returned URL. Nothing is written to this server's disk.
// To save cloud storage, photos are shrunk on arrival (max 1280px, low quality, WebP) and only that
// smaller copy is stored. GIFs keep their animation; documents are stored as they are.
export const CLOUD_IMAGE_TRANSFORM = 'c_limit,w_1280,h_1280/q_auto:low';
const signCloud = (params) => crypto.createHash('sha1')
  .update(Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&') + CLOUDINARY.secret).digest('hex');
const makeCloudStorage = ({ compress }) => ({
  _handleFile(_req, file, cb) {
    const chunks = [];
    let size = 0;
    file.stream.on('data', (c) => { chunks.push(c); size += c.length; });
    file.stream.on('error', cb);
    file.stream.on('end', async () => {
      try {
        const timestamp = Math.floor(Date.now() / 1000);
        const params = { folder: CLOUDINARY.folder, timestamp };
        if (compress && /^image\//.test(file.mimetype) && file.mimetype !== 'image/gif' && file.mimetype !== 'image/svg+xml') {
          params.transformation = CLOUD_IMAGE_TRANSFORM;
          params.format = 'webp';
        }
        const signature = signCloud(params);
        const form = new FormData();
        form.append('file', new Blob([Buffer.concat(chunks)], { type: file.mimetype }), file.originalname || 'upload');
        Object.entries(params).forEach(([k, v]) => form.append(k, String(v)));
        form.append('api_key', CLOUDINARY.key);
        form.append('signature', signature);
        const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloud}/auto/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
        const j = await r.json();
        if (!r.ok) throw new HttpError(502, j?.error?.message || 'Upload failed.');
        cb(null, { cloudUrl: j.secure_url, filename: j.public_id, size });
      } catch (e) { cb(e instanceof HttpError ? e : new HttpError(502, 'Upload failed. Please try again.')); }
    });
  },
  _removeFile(_req, _file, cb) { cb(null); },
});
const cloudPhotos = makeCloudStorage({ compress: true });
const cloudFiles = makeCloudStorage({ compress: false });
const pick = (cloud) => ({
  _handleFile: (req, file, cb) => (cloudinaryEnabled() ? cloud : diskStorage)._handleFile(req, file, cb),
  _removeFile: (req, file, cb) => (cloudinaryEnabled() ? cloud : diskStorage)._removeFile(req, file, cb),
});
const imageFilter = (_req, file, cb) => {
  if (/^image\/(png|jpe?g|gif|webp|avif|heic|heif)$/.test(file.mimetype)) cb(null, true);
  else cb(new HttpError(400, 'Only image files are allowed.'));
};
export const imageUpload = multer({ storage: pick(cloudPhotos), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024, files: 10 } });
// Chat files: photos are compressed, other files are kept as they are.
export const fileUpload = multer({ storage: pick(cloudPhotos), limits: { fileSize: 15 * 1024 * 1024, files: 10 } });
// Email attachments are sent on to people outside Hunch, so they are never altered.
export const attachmentUpload = multer({ storage: pick(cloudFiles), limits: { fileSize: 15 * 1024 * 1024, files: 10 } });
export const fileUrl = (f) => (!f ? null : f.cloudUrl || `${API_URL}/uploads/${f.filename}`);

// ---------- permanent deletion ----------
// Every place a stored file can be referenced. A file is only deleted when nothing points to it any more
// (for example, a story photo that is still a highlight cover is kept).
const MEDIA_COLUMNS = [
  ['users', 'avatar'], ['users', 'cover'], ['post_images', 'url'], ['comments', 'image'], ['stories', 'image'],
  ['highlights', 'cover_image'], ['conversations', 'photo'], ['messages', 'image'],
];
const MEDIA_JSON = [['messages', 'attachment'], ['emails', 'attachments']];
const stillUsed = (url) => MEDIA_COLUMNS.some(([t, c]) => get(`SELECT 1 x FROM ${t} WHERE ${c} = ? LIMIT 1`, url))
  || MEDIA_JSON.some(([t, c]) => get(`SELECT 1 x FROM ${t} WHERE instr(${c}, ?) > 0 LIMIT 1`, JSON.stringify(url).slice(1, -1)));

const CLOUD_URL = /^https:\/\/res\.cloudinary\.com\/([^/]+)\/(image|video|raw)\/upload\/(?:[^/]+\/)*?v\d+\/(.+)$/;
async function destroyCloud(url) {
  const m = CLOUD_URL.exec(url);
  if (!m || m[1] !== CLOUDINARY.cloud) return;
  const [, , type, rest] = m;
  const publicId = decodeURIComponent(type === 'raw' ? rest : rest.replace(/\.[a-z0-9]+$/i, ''));
  const params = { invalidate: 'true', public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };
  const form = new FormData();
  Object.entries(params).forEach(([k, v]) => form.append(k, String(v)));
  form.append('api_key', CLOUDINARY.key);
  form.append('signature', signCloud(params));
  const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloud}/${type}/destroy`, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.result !== 'ok' && j.result !== 'not found')) throw new Error(j?.error?.message || j.result || `HTTP ${r.status}`);
}

/**
 * Permanently delete stored files (Cloudinary or backend/uploads) that are no longer used anywhere.
 * Call it AFTER the database row was changed or deleted. Runs in the background and never throws.
 */
export function deleteStoredFiles(...urls) {
  const list = [...new Set(urls.flat().filter((u) => typeof u === 'string' && u))];
  for (const url of list) {
    if (stillUsed(url)) continue;
    if (CLOUD_URL.test(url)) {
      if (!cloudinaryEnabled()) continue;
      destroyCloud(url).catch((e) => console.warn(`[hunch] Could not delete a cloud file: ${e.message}`));
    } else if (url.includes('/uploads/')) {
      const name = path.basename(url.split('?')[0]);
      if (!/^[\w.-]+$/.test(name)) continue;
      fs.promises.unlink(path.join(UPLOAD_DIR, name)).catch((e) => e.code !== 'ENOENT' && console.warn(`[hunch] Could not delete ${name}: ${e.message}`));
    }
  }
}
/** URLs inside a JSON attachment list (messages.attachment / emails.attachments). */
export const attachmentUrls = (json) => {
  try { const v = JSON.parse(json || 'null'); return (Array.isArray(v) ? v : v ? [v] : []).map((a) => a?.url).filter(Boolean); } catch { return []; }
};

// ---------- user projections ----------
export const PUBLIC_COLS = 'id, user_code, username, full_name, avatar, role, bio, job_title, location, privacy, created_at';
export const publicUser = (id) => (id ? get(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`, id) : null);
export const selfUser = (u) => {
  if (!u) return null;
  const { password_hash, verify_code, verify_expires, ...rest } = u;
  return rest;
};

// ---------- friendships ----------
export const friendshipBetween = (a, b) =>
  get(
    `SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
    a, b, b, a
  );
export const areFriends = (a, b) => a === b || friendshipBetween(a, b)?.status === 'accepted';
export const friendIds = (uid) =>
  all(
    `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS id
     FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`,
    uid, uid, uid
  ).map((r) => r.id);
// Blocking hides both people from each other everywhere.
export const isBlocked = (a, b) => a !== b && !!get('SELECT 1 x FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)', a, b, b, a);
export const blockedIds = (uid) => all('SELECT blocked_id id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?', uid, uid).map((r) => r.id);
export const canViewProfile = (viewerId, target) =>
  target && !isBlocked(viewerId, target.id) && (target.id === viewerId || target.privacy === 'public' || areFriends(viewerId, target.id));
