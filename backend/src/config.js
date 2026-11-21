// Runtime configuration, read once from the environment (.env locally, host env vars in production).
// Nothing secret lives in the code: see backend/.env.example for every variable.
export const IS_PROD = process.env.NODE_ENV === 'production';
export const PORT = Number(process.env.PORT) || 5000;

const list = (v) => String(v || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
export const CLIENT_URL = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
export const ADMIN_URL = (process.env.ADMIN_URL || 'http://localhost:3000').replace(/\/$/, '');
// Public base URL of this API, used to build absolute links to locally stored uploads.
export const API_URL = (process.env.API_URL || '').replace(/\/$/, '');

// Browsers may only call the API from the client and admin apps (plus any extra origins listed).
export const ALLOWED_ORIGINS = [...new Set([CLIENT_URL, ADMIN_URL, ...list(process.env.EXTRA_ORIGINS)])];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
export const originAllowed = (origin) => !origin || ALLOWED_ORIGINS.includes(origin) || (!IS_PROD && LOCAL.test(origin));
export const corsOptions = {
  origin: (origin, cb) => (originAllowed(origin) ? cb(null, true) : cb(new Error('Origin not allowed by CORS'))),
  credentials: true,
};

export const CLOUDINARY = {
  cloud: process.env.CLOUDINARY_CLOUD_NAME || '',
  key: process.env.CLOUDINARY_API_KEY || '',
  secret: process.env.CLOUDINARY_API_SECRET || '',
  folder: process.env.CLOUDINARY_FOLDER || 'hunch',
};
export const cloudinaryEnabled = () => !!(CLOUDINARY.cloud && CLOUDINARY.key && CLOUDINARY.secret);

if (IS_PROD) {
  const missing = ['JWT_SECRET', 'CLIENT_URL', 'ADMIN_URL'].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`[hunch] Missing required production environment variables: ${missing.join(', ')}`);
  if (!cloudinaryEnabled()) console.warn('[hunch] Cloudinary is not configured: uploads will be stored on this server’s disk.');
}
