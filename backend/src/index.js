// Load and validate configuration first, before the database is opened or any account is created.
import './config.js';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { Server } from 'socket.io';
import { UPLOAD_DIR, get } from './db.js';
import { verifyToken } from './auth.js';
import { HttpError } from './util.js';
import { PORT, IS_PROD, corsOptions, originAllowed } from './config.js';
import { setIO, markOnline } from './realtime.js';
import { startScheduler } from './scheduler.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import postRoutes from './routes/posts.js';
import storyRoutes from './routes/stories.js';
import chatRoutes from './routes/chats.js';
import notificationRoutes from './routes/notifications.js';
import adminRoutes from './routes/admin.js';
import teamRoutes from './routes/teams.js';
import mapRoutes from './routes/map.js';
import workRoutes from './routes/work.js';
import chatContextRoutes from './routes/chatContext.js';
import searchRoutes from './routes/search.js';
import { registerCalls } from './calls.js';
import { memberIds as chatMemberIds, postMessage as chatPost } from './routes/chats.js';
import { publicUser } from './util.js';

const app = express();
app.disable('x-powered-by');
if (IS_PROD) app.set('trust proxy', 1); // behind the host's HTTPS proxy
// Security headers. The API serves JSON only, so the strict defaults fit; uploads set their own CSP below.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(corsOptions));
// Rate limits: a general ceiling per IP, and a much tighter one on sign-in and password endpoints.
app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(['/api/auth/login', '/api/auth/google', '/api/auth/signup', '/api/auth/forgot', '/api/auth/account-request', '/api/auth/verify', '/api/auth/change-password'],
  rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many attempts. Please wait a few minutes and try again.' } }));
app.use(express.json({ limit: '1mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '7d',
  setHeaders: (res, file) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
    // Anything that isn't an image or video is downloaded, never rendered.
    if (!/\.(png|jpe?g|gif|webp|avif|heic|heif|mp4|webm|mov|m4v)$/i.test(file)) res.setHeader('Content-Disposition', 'attachment');
  },
}));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/admin/teams', teamRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', notificationRoutes);
app.use('/api', userRoutes);
app.use('/api', storyRoutes);
app.use('/api', postRoutes);
app.use('/api', chatContextRoutes);
app.use('/api', searchRoutes);
app.use('/api', chatRoutes);
app.use('/api', mapRoutes);
app.use('/api', workRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// Serve production builds if present (npm run build).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const [mount, dir] of [['/admin', '../../admin/dist'], ['/', '../../client/dist']]) {
  const abs = path.resolve(__dirname, dir);
  if (fs.existsSync(abs)) {
    app.use(mount, express.static(abs));
    app.get(mount === '/' ? /^\/(?!api|uploads|socket\.io|admin).*/ : /^\/admin(\/.*)?$/, (_req, res) => res.sendFile(path.join(abs, 'index.html')));
  }
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : err.message });
  if (err?.message === 'Origin not allowed by CORS') return res.status(403).json({ error: 'Origin not allowed.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: (origin, cb) => cb(null, originAllowed(origin)), credentials: true } });
setIO(io);
io.use((socket, next) => {
  const p = verifyToken(socket.handshake.auth?.token);
  const u = p && get("SELECT id, status FROM users WHERE id = ?", p.sub);
  if (!u || u.status !== 'active') return next(new Error('unauthorized'));
  socket.userId = u.id;
  next();
});
io.on('connection', (socket) => {
  const uid = socket.userId;
  socket.join(`user:${uid}`);
  markOnline(uid, 1);
  // Typing indicator: relay to other members of the conversation.
  socket.on('typing', ({ conversationId, typing } = {}) => {
    const cid = Number(conversationId);
    if (!get('SELECT 1 x FROM conversation_members WHERE conversation_id = ? AND user_id = ?', cid, uid)) return;
    const name = get('SELECT full_name FROM users WHERE id = ?', uid)?.full_name;
    import('./routes/chats.js').then(({ memberIds }) => {
      memberIds(cid).filter((id) => id !== uid).forEach((id) => io.to(`user:${id}`).emit('typing', { conversationId: cid, userId: uid, name, typing: !!typing }));
    });
  });
  registerCalls(io, socket, { memberIds: chatMemberIds, postMessage: chatPost, publicUser });
  socket.on('disconnect', () => markOnline(uid, -1));
});

server.listen(PORT, () => {
  console.log(`[hunch] API + realtime running on http://localhost:${PORT}`);
  startScheduler();
});
