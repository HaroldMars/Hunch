// Prepares demo content for marketing screenshots, using demo accounts only (…@hunch.local).
// Never touches the initial admin or any account that isn't part of the demo organisation.
//
//  Once:  illustrated avatars for demo people, a demo developer (Sam Rivera), a first-login
//         demo account (Kai Morales), Team Tristan posts with images, chats, a pinned message,
//         a repost and a highlight for Hans.
//  Every run (these expire after 24 h): notes, location stories, shared locations, check-ins.
//
// Usage (server must be running):  node prepare-demo.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { CHROME, API, ROOT, PASSWORD as PW } from './config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(ROOT, 'backend/package.json'));
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const db = new DatabaseSync(path.join(ROOT, 'backend/data/hunch.db'));
const PASSWORD = 'Hunch@2026';
const FORCE = process.argv.includes('--force');
const MARK = path.join(here, '.demo-prepared');
const GEN = path.join(here, 'generated');
fs.mkdirSync(GEN, { recursive: true });

const one = (sql, ...p) => db.prepare(sql).get(...p);
const tokens = {};
async function login(email) {
  if (tokens[email]) return tokens[email];
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: email, password: PASSWORD }) }).then((x) => x.json());
  if (!r.token) throw new Error(`Login failed for ${email}: ${r.error}`);
  return (tokens[email] = r.token);
}
async function call(email, p, { method = 'GET', body, form } = {}) {
  const t = await login(email);
  const r = await fetch(API + p, { method, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: form || (body ? JSON.stringify(body) : undefined) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${p} (${email}): ${j?.error || r.status}`);
  return j;
}
const fileForm = (fields, files = {}) => {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => v != null && f.append(k, String(v)));
  Object.entries(files).forEach(([k, list]) => [].concat(list).forEach((p) => f.append(k, new Blob([fs.readFileSync(p)], { type: 'image/png' }), path.basename(p))));
  return f;
};
const email = (name) => `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@hunch.local`;

// ---------- illustrated images (drawn on canvas, no stock photos) ----------
async function drawImages() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  const people = db.prepare("SELECT id, full_name FROM users WHERE email LIKE '%@hunch.local' AND email NOT LIKE 'test.agent%' AND id <> 5").all();
  const out = await page.evaluate((people) => {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    const rnd = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const avatars = {};
    const BG = [['#ffd6e7', '#ffb3c7'], ['#d6e4ff', '#a8c5ff'], ['#d9f7be', '#b7eb8f'], ['#fff1b8', '#ffe58f'], ['#efdbff', '#d3adf7'], ['#c9f2f0', '#87e8de'], ['#ffe7ba', '#ffd591']];
    const SKIN = ['#f5d0b5', '#e8b796', '#d39b72', '#b97a56', '#8d5a3b'];
    const HAIR = ['#2b1b14', '#4a2c1d', '#6b3e26', '#1d1d1f', '#8a5a2b', '#3b2a4a'];
    const SHIRT = ['#5b8def', '#ff7a59', '#2ec4b6', '#a78bfa', '#f59e0b', '#ef476f', '#118ab2'];
    for (const p of people) {
      const r = rnd(p.id * 7919 + 13);
      c.width = c.height = 512;
      const bg = BG[p.id % BG.length];
      const grd = g.createLinearGradient(0, 0, 512, 512); grd.addColorStop(0, bg[0]); grd.addColorStop(1, bg[1]);
      g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
      const skin = SKIN[(p.id * 3) % SKIN.length], hair = HAIR[(p.id * 5 + 1) % HAIR.length], shirt = SHIRT[p.id % SHIRT.length];
      const long = p.id % 2 === 1;
      // shoulders
      g.fillStyle = shirt; g.beginPath(); g.ellipse(256, 520, 190, 150, 0, Math.PI, 0); g.fill();
      // neck
      g.fillStyle = skin; g.fillRect(226, 330, 60, 60);
      // long hair behind
      if (long) { g.fillStyle = hair; g.beginPath(); g.ellipse(256, 250, 122, 140, 0, 0, Math.PI * 2); g.fill(); g.fillRect(134, 250, 244, 150); }
      // head
      g.fillStyle = skin; g.beginPath(); g.ellipse(256, 245, 98, 112, 0, 0, Math.PI * 2); g.fill();
      // hair top
      g.fillStyle = hair; g.beginPath(); g.ellipse(256, 175, 108, 70, 0, Math.PI, 0); g.fill();
      g.beginPath(); g.ellipse(long ? 210 : 230, 165, 90, 46, -0.35, 0, Math.PI * 2); g.fill();
      // eyes + smile + cheeks
      g.fillStyle = '#2b2b2b'; g.beginPath(); g.arc(222, 252, 9, 0, Math.PI * 2); g.arc(290, 252, 9, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#2b2b2b'; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.arc(256, 280, 30, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
      g.fillStyle = 'rgba(255,120,120,.25)'; g.beginPath(); g.arc(205, 290, 16, 0, Math.PI * 2); g.arc(307, 290, 16, 0, Math.PI * 2); g.fill();
      avatars[p.id] = c.toDataURL('image/png');
    }
    // scenes 1080x1350
    const scenes = {};
    const scene = (name, fn) => { c.width = 1080; c.height = 1350; fn(); scenes[name] = c.toDataURL('image/png'); };
    const lin = (stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1350) => { const l = g.createLinearGradient(x1, y1, x2, y2); stops.forEach(([o, col]) => l.addColorStop(o, col)); return l; };
    scene('sunset', () => {
      g.fillStyle = lin([[0, '#1d2671'], [0.45, '#c33764'], [0.7, '#ff9966']]); g.fillRect(0, 0, 1080, 1350);
      g.fillStyle = '#ffd27a'; g.beginPath(); g.arc(540, 780, 150, Math.PI, 0); g.fill();
      for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(20,30,80,${0.55 + i * 0.05})`; g.fillRect(0, 780 + i * 64, 1080, 64); g.fillStyle = 'rgba(255,210,122,.35)'; g.fillRect(380 + i * 18, 800 + i * 64, 320 - i * 36, 8); }
    });
    scene('city', () => {
      g.fillStyle = lin([[0, '#0f2027'], [0.6, '#203a43'], [1, '#2c5364']]); g.fillRect(0, 0, 1080, 1350);
      const r = rnd(42);
      for (let x = 0; x < 1080; x += 90) { const h = 380 + r() * 520; g.fillStyle = '#0b1a24'; g.fillRect(x, 1350 - h, 82, h); for (let y = 1350 - h + 30; y < 1330; y += 46) for (let w = 0; w < 3; w++) if (r() > 0.35) { g.fillStyle = r() > 0.5 ? '#ffd27a' : '#9cc8ff'; g.fillRect(x + 12 + w * 22, y, 12, 20); } }
      g.fillStyle = '#f5f5f5'; g.beginPath(); g.arc(840, 220, 60, 0, Math.PI * 2); g.fill();
    });
    scene('coffee', () => {
      g.fillStyle = lin([[0, '#f6e7d7'], [1, '#e9cfb3']]); g.fillRect(0, 0, 1080, 1350);
      g.fillStyle = '#c69c72'; g.beginPath(); g.ellipse(540, 820, 360, 90, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(330, 520); g.lineTo(750, 520); g.lineTo(700, 860); g.lineTo(380, 860); g.closePath(); g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = 38; g.beginPath(); g.arc(770, 650, 80, -1.2, 1.2); g.stroke();
      g.fillStyle = '#6f4e37'; g.beginPath(); g.ellipse(540, 530, 205, 34, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 10; g.beginPath(); g.moveTo(470, 500); g.bezierCurveTo(440, 430, 520, 400, 490, 330); g.moveTo(580, 500); g.bezierCurveTo(550, 420, 630, 400, 600, 320); g.stroke();
      g.fillStyle = '#5b8def'; g.font = 'bold 64px Arial'; g.textAlign = 'center'; g.fillText('monday fuel', 540, 1080);
    });
    scene('mountain', () => {
      g.fillStyle = lin([[0, '#a1c4fd'], [1, '#c2e9fb']]); g.fillRect(0, 0, 1080, 1350);
      const peak = (x, w, h, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(x - w, 1350); g.lineTo(x, 1350 - h); g.lineTo(x + w, 1350); g.fill(); };
      peak(300, 520, 900, '#5a7fa8'); peak(820, 560, 760, '#3f6288'); peak(560, 640, 520, '#2f8f5b'); peak(120, 380, 380, '#257a4b'); peak(1000, 420, 420, '#257a4b');
      g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(300, 450); g.lineTo(230, 560); g.lineTo(370, 560); g.fill();
    });
    scene('desk', () => {
      g.fillStyle = lin([[0, '#e0eafc'], [1, '#cfdef3']]); g.fillRect(0, 0, 1080, 1350);
      g.fillStyle = '#8d6e63'; g.fillRect(0, 900, 1080, 450);
      g.fillStyle = '#263238'; g.fillRect(250, 420, 580, 360); g.fillStyle = '#5b8def'; g.fillRect(275, 445, 530, 310);
      g.fillStyle = '#ffffff'; for (let i = 0; i < 5; i++) g.fillRect(310, 480 + i * 50, 260 + (i % 2) * 140, 22);
      g.fillStyle = '#37474f'; g.fillRect(500, 780, 80, 120); g.fillRect(400, 890, 280, 20);
      g.fillStyle = '#43a047'; g.beginPath(); g.ellipse(900, 760, 70, 140, 0.2, 0, Math.PI * 2); g.fill(); g.fillStyle = '#ef6c00'; g.fillRect(860, 840, 80, 100);
    });
    scene('beach', () => {
      g.fillStyle = lin([[0, '#56ccf2'], [0.55, '#2f80ed']]); g.fillRect(0, 0, 1080, 1350);
      g.fillStyle = '#4fc3f7'; g.fillRect(0, 700, 1080, 300);
      g.fillStyle = '#f7e1b5'; g.beginPath(); g.moveTo(0, 950); g.bezierCurveTo(400, 880, 700, 1000, 1080, 930); g.lineTo(1080, 1350); g.lineTo(0, 1350); g.fill();
      g.fillStyle = '#fff59d'; g.beginPath(); g.arc(860, 230, 90, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#6d4c41'; g.lineWidth = 26; g.beginPath(); g.moveTo(220, 1100); g.quadraticCurveTo(250, 820, 330, 640); g.stroke();
      g.fillStyle = '#2e7d32'; for (let a = 0; a < 6; a++) { g.beginPath(); g.ellipse(330, 640, 170, 34, a * 0.55 - 0.3, 0, Math.PI * 2); g.fill(); }
    });
    return { avatars, scenes };
  }, people);
  await browser.close();
  const write = (name, dataUrl) => { const p = path.join(GEN, name); fs.writeFileSync(p, Buffer.from(dataUrl.split(',')[1], 'base64')); return p; };
  const avatarFiles = Object.fromEntries(Object.entries(out.avatars).map(([id, d]) => [id, write(`avatar-${id}.png`, d)]));
  const sceneFiles = Object.fromEntries(Object.entries(out.scenes).map(([k, d]) => [k, write(`scene-${k}.png`, d)]));
  return { avatarFiles, sceneFiles, people };
}

// ---------- extra demo accounts ----------
function ensureAccount({ name, mail, role, tl = null, title, ready }) {
  let u = one('SELECT id FROM users WHERE email = ?', mail);
  if (!u) {
    const r = db.prepare(`INSERT INTO users (username, email, password_hash, full_name, role, team_leader_id, job_title, bio, location, privacy, must_change_password, verified, profile_completed, settings)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Cebu City', 'public', ?, ?, ?, '{}')`).run(
      role === 'agent' ? null : name.toLowerCase().replace(/[^a-z]+/g, ''), mail, bcrypt.hashSync(PASSWORD, 10), name, role, tl, title, ready ? 'Keeping Hunch running smoothly.' : '', ready ? 0 : 1, ready ? 1 : 0, ready ? 1 : 0);
    const id = Number(r.lastInsertRowid);
    db.prepare('UPDATE users SET user_code = ? WHERE id = ?').run('HN' + (100000 + id), id);
    u = { id };
  }
  return u.id;
}

async function main() {
  const firstRun = FORCE || !fs.existsSync(MARK);
  const tristan = one('SELECT * FROM users WHERE email = ?', email('Tristan Cruz'));
  if (!tristan) throw new Error('Demo organisation missing. Run `npm run seed:demo` first.');
  ensureAccount({ name: 'Sam Rivera', mail: 'sam.rivera@hunch.local', role: 'developer', title: 'Platform Developer', ready: true });
  ensureAccount({ name: 'Kai Morales', mail: 'kai.morales@hunch.local', role: 'agent', tl: tristan.id, title: 'Customer Support Agent', ready: false });

  const { avatarFiles, sceneFiles } = await drawImages();
  const T = ['Tristan Cruz', 'Lea Navarro', 'Franco Yap', 'Gia Mendoza', 'Hans Aquino', 'Iris Bautista', 'Jomar Flores'];

  if (process.argv.includes('--avatars') && !firstRun) {
    const demo = db.prepare("SELECT id, email FROM users WHERE email LIKE '%@hunch.local' AND email NOT LIKE 'test.agent%' AND id NOT IN (1, 5) AND must_change_password = 0").all();
    for (const u of demo) if (avatarFiles[u.id]) await call(u.email, '/users/me/avatar', { method: 'POST', form: fileForm({}, { avatar: avatarFiles[u.id] }) }).catch((e) => console.warn(e.message));
  }
  if (firstRun) {
    // Avatars for demo people (skips the initial admin and the user's own account).
    const demo = db.prepare("SELECT id, email FROM users WHERE email LIKE '%@hunch.local' AND email NOT LIKE 'test.agent%' AND id NOT IN (1, 5) AND must_change_password = 0").all();
    for (const u of demo) if (avatarFiles[u.id]) await call(u.email, '/users/me/avatar', { method: 'POST', form: fileForm({}, { avatar: avatarFiles[u.id] }) }).catch((e) => console.warn(e.message));
    const sam = one("SELECT id FROM users WHERE email = 'sam.rivera@hunch.local'");
    // Sam gets a drawn avatar too (generated after insert on later runs; draw now if missing)
    if (avatarFiles[sam.id]) await call('sam.rivera@hunch.local', '/users/me/avatar', { method: 'POST', form: fileForm({}, { avatar: avatarFiles[sam.id] }) }).catch(() => {});

    // Public posts with illustrated photos, plus likes and comments.
    const posts = [
      ['Iris Bautista', 'Sunset after a long shift. Grateful for this team 🌅', ['sunset']],
      ['Jomar Flores', 'Weekend hike with the crew. Who is joining next time? 🏔️', ['mountain', 'beach']],
      ['Gia Mendoza', 'New desk setup is finally done ✨ Productivity mode on.', ['desk']],
      ['Lea Navarro', 'Monday fuel ☕ Let’s make this week a good one, team!', ['coffee']],
      ['Franco Yap', 'City lights on the way home 🌃', ['city']],
    ];
    const ids = [];
    for (const [who, text, imgs] of posts) {
      const p = await call(email(who), '/posts', { method: 'POST', form: fileForm({ text }, { images: imgs.map((k) => sceneFiles[k]) }) });
      ids.push(p.id);
    }
    const likeComment = [[0, ['Hans Aquino', 'Gia Mendoza', 'Tristan Cruz', 'Jomar Flores'], [['Hans Aquino', 'This view 😍'], ['Tristan Cruz', 'Well deserved rest, Iris!']]],
      [1, ['Hans Aquino', 'Iris Bautista', 'Lea Navarro'], [['Iris Bautista', 'Count me in next time!'], ['Hans Aquino', 'Bring snacks 😂']]],
      [2, ['Hans Aquino', 'Franco Yap'], [['Franco Yap', 'Clean setup!']]],
      [3, ['Hans Aquino', 'Gia Mendoza', 'Iris Bautista', 'Jomar Flores', 'Franco Yap'], [['Jomar Flores', 'Coffee first, always ☕']]]];
    for (const [i, likers, comments] of likeComment) {
      for (const l of likers) await call(email(l), `/posts/${ids[i]}/like`, { method: 'POST' });
      for (const [c, t] of comments) await call(email(c), `/posts/${ids[i]}/comments`, { method: 'POST', form: fileForm({ text: t }) });
    }
    await call(email('Hans Aquino'), `/posts/${ids[1]}/repost`, { method: 'POST', body: {} }); // Reposts tab
    await call(email('Hans Aquino'), '/posts', { method: 'POST', form: fileForm({ text: 'Beach day reset 🏝️ Back to work with a full battery!' }, { images: [sceneFiles.beach] }) });

    // Chats for Hans: direct chats and a pinned message in the team group.
    const dm = async (from, to, lines) => {
      const c = await call(email(from), '/conversations/direct', { method: 'POST', body: { userId: one('SELECT id FROM users WHERE email = ?', email(to)).id } });
      for (const [who, text] of lines) await call(email(who), `/conversations/${c.id}/messages`, { method: 'POST', form: fileForm({ text }) });
      return c.id;
    };
    await dm('Hans Aquino', 'Iris Bautista', [['Iris Bautista', 'Hey! Are you joining the QA calibration later?'], ['Hans Aquino', 'Yes! I picked two calls already 🎧'], ['Iris Bautista', 'Nice, see you at 3 😊']]);
    await dm('Hans Aquino', 'Jomar Flores', [['Jomar Flores', 'Hike again this Saturday?'], ['Hans Aquino', 'I’m in! Same trail?'], ['Jomar Flores', 'Yep, meet at 5:30 AM 🏔️']]);
    const group = db.prepare("SELECT c.id FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id WHERE c.type = 'group' AND m.user_id = ?").get(one('SELECT id FROM users WHERE email = ?', email('Hans Aquino')).id);
    if (group) {
      const pin = await call(email('Tristan Cruz'), `/conversations/${group.id}/messages`, { method: 'POST', form: fileForm({ text: '📌 Reminder: QA calibration Thursday 3 PM. Bring two calls for feedback.' }) });
      await call(email('Tristan Cruz'), `/messages/${pin.id}/pin`, { method: 'POST' }).catch(() => {});
      for (const [who, text] of [['Lea Navarro', 'Refund macro v3 is live, ping me with questions 🙌'], ['Gia Mendoza', 'Thanks Lea!'], ['Hans Aquino', 'Got it, thank you!']]) await call(email(who), `/conversations/${group.id}/messages`, { method: 'POST', form: fileForm({ text }) });
    }
    fs.writeFileSync(MARK, new Date().toISOString());
  }

  // ---------- refreshed every run (24 h content) ----------
  for (const who of T) {
    const s = await call(email(who), '/users/me/settings');
    if (s.location_sharing !== 'friends') await call(email(who), '/users/me/settings', { method: 'PATCH', body: { location_sharing: 'friends' } });
  }
  const PLACES = { itpark: ['Cebu IT Park', 10.3302, 123.9063], ayala: ['Ayala Center Cebu', 10.3181, 123.9051], tops: ['Tops Lookout, Busay', 10.37, 123.8636], seaside: ['SM Seaside City Cebu', 10.2817, 123.8807], fuente: ['Fuente Osmeña Circle', 10.3109, 123.8919] };
  const hasStory = (who, place) => one('SELECT 1 x FROM stories s JOIN users u ON u.id = s.user_id WHERE u.email = ? AND s.place_name = ? AND s.expires_at > ?', email(who), place, new Date().toISOString());
  const stories = [['Iris Bautista', 'itpark', 'happy', 'Team lunch 🍜', 'sunset'], ['Jomar Flores', 'tops', 'excited', 'Sunrise hike done ✅', 'mountain'], ['Gia Mendoza', 'itpark', 'chill', 'Coffee break', 'coffee'],
    ['Lea Navarro', 'ayala', 'energetic', 'Errands then gym 💪', 'city'], ['Hans Aquino', 'seaside', 'chill', 'Beach walk 🌊', 'beach'], ['Tristan Cruz', 'itpark', 'happy', 'Proud of Team Tristan this week!', 'desk']];
  for (const [who, place, mood, text, img] of stories) {
    const [name, lat, lng] = PLACES[place];
    if (hasStory(who, name)) continue;
    await call(email(who), '/stories', { method: 'POST', form: fileForm({ text, mood, theme: 'ocean', allow_comments: '1', place_name: name, lat: lat + (Math.random() - 0.5) * 0.002, lng: lng + (Math.random() - 0.5) * 0.002 }, { image: sceneFiles[img] }) });
  }
  for (const [who, place] of [['Iris Bautista', 'itpark'], ['Jomar Flores', 'fuente'], ['Lea Navarro', 'ayala']]) {
    const [n, lat, lng] = PLACES[place];
    await call(email(who), '/map/location', { method: 'PUT', body: { lat: lat + 0.0007, lng: lng - 0.0005, place_name: n } });
  }
  const notes = [['Iris Bautista', { text: 'QA calibration at 3, wish me luck', emoji: '🎧', mood: 'excited' }], ['Jomar Flores', { text: 'Hike this Saturday?', emoji: '🏔️' }],
    ['Gia Mendoza', { text: 'Need coffee asap', emoji: '☕', mood: 'sleepy', color: '#c4a1ff' }], ['Lea Navarro', { text: 'Refund macro v3 is live!', emoji: '🎉', color: '#9cc8ff' }], ['Tristan Cruz', { text: 'Proud of this team', emoji: '💙', mood: 'happy' }]];
  for (const [who, body] of notes) await call(email(who), '/notes', { method: 'POST', body });
  for (const [who, mood] of [['Hans Aquino', 'happy'], ['Iris Bautista', 'excited'], ['Gia Mendoza', 'tired'], ['Jomar Flores', 'energetic'], ['Franco Yap', 'chill']]) await call(email(who), '/moods/checkin', { method: 'POST', body: { mood } });
  // A few internal emails so the dashboard Email System has real content (sent once).
  const sam = one("SELECT id FROM users WHERE email = 'sam.rivera@hunch.local'");
  if (!one("SELECT 1 x FROM emails WHERE subject = 'Weekly team pulse: Team Tristan'")) {
    const adminTok = async (mail) => (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: mail, password: PASSWORD, app: 'admin' }) }).then((x) => x.json())).token;
    const send = async (from, to, subject, body) => {
      const t = await adminTok(from);
      const f = new FormData(); f.append('to', JSON.stringify(to)); f.append('subject', subject); f.append('body', body); f.append('action', 'send');
      const r = await fetch(`${API}/admin/email`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: f });
      if (!r.ok) console.warn('email', subject, (await r.json().catch(() => ({}))).error);
    };
    await send(email('Tristan Cruz'), ['sam.rivera@hunch.local', 'maria.santos@hunch.local'], 'Weekly team pulse: Team Tristan', 'Hi Sam and Maria,\n\nParticipation was 86% this week and positive moods are trending up. Two people flagged tired three days in a row, so I scheduled 1:1 coaching for Thursday.\n\nTristan');
    await send(email('Lea Navarro'), ['sam.rivera@hunch.local'], 'Refund macro v3 rollout', 'Hi Sam,\n\nThe refund macro v3 is live for Team Tristan. Could we add a pinned announcement template in the Work feed for future rollouts?\n\nThanks,\nLea');
    await send('maria.santos@hunch.local', ['sam.rivera@hunch.local'], 'Q4 engagement review', 'Hi Sam,\n\nPlease prepare the Q4 engagement export (mood participation, active users and Work feed activity per team) before Friday.\n\nMaria');
  }
  // Hans's highlight (from his own stories), created once.
  const hans = one('SELECT id FROM users WHERE email = ?', email('Hans Aquino'));
  if (!one('SELECT 1 x FROM highlights WHERE user_id = ?', hans.id)) {
    const mine = await call(email('Hans Aquino'), '/stories/archive');
    if (mine.length) await call(email('Hans Aquino'), '/highlights', { method: 'POST', body: { title: 'Weekend', storyIds: mine.slice(0, 3).map((s) => s.id), cover_emoji: '🌊' } });
  }
  console.log(firstRun ? 'Demo content prepared.' : 'Demo content refreshed (notes, stories, locations).');
}
main().catch((e) => { console.error(e); process.exit(1); });
