// Captures real Hunch screens into marketing/Product Screenshots.
// Phone screens: 390×844 at 3× (1170×2532). Dashboard screens: 1440×900 at 2×.
// Personas are demo accounts only: Hans (agent), Tristan (TL), Lea (SME), Maria (manager), Sam (developer), Kai (new user).
// Usage (app running via `npm run dev`):  node capture.mjs [filter]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME, API, CLIENT, ADMIN, MARKETING, PASSWORD } from './config.mjs';

const OUT = path.join(MARKETING, 'Product Screenshots');
const only = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const E = {
  hans: 'hans.aquino@hunch.local', tristan: 'tristan.cruz@hunch.local', lea: 'lea.navarro@hunch.local',
  maria: 'maria.santos@hunch.local', sam: 'sam.rivera@hunch.local', kai: 'kai.morales@hunch.local', jomar: 'jomar.flores@hunch.local',
};
const login = async (who, app = 'client') => (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: E[who], password: PASSWORD, app, remember: true }) }).then((r) => r.json())).token;
const apiAs = async (tok, p, opts = {}) => fetch(API + p, { method: opts.method || 'GET', headers: { authorization: `Bearer ${tok}`, ...(opts.body ? { 'content-type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }).then((r) => r.json());

// ---------- context ----------
const T = {};
for (const w of ['hans', 'tristan', 'lea', 'kai']) T[w] = await login(w);
for (const w of ['tristan', 'lea', 'maria', 'sam']) T[`${w}A`] = await login(w, 'admin');
const convs = await apiAs(T.hans, '/conversations');
const dmIris = convs.find((c) => c.type === 'direct' && c.title?.startsWith('Iris'))?.id;
const group = convs.find((c) => c.type === 'group')?.id;
const feed = await apiAs(T.hans, '/posts/feed?tab=foryou');
const hike = feed.posts.find((p) => p.text?.startsWith('Weekend hike'))?.id || feed.posts[0].id;
const jomar = (await apiAs(T.hans, '/search?q=Jomar')).users?.[0]?.id || (await apiAs(T.hans, '/friends')).find((f) => f.full_name.startsWith('Jomar'))?.id;
const tristanId = (await apiAs(T.hans, '/friends')).find((f) => f.full_name.startsWith('Tristan'))?.id;
const hansId = (await apiAs(T.hans, '/auth/me')).user.id;

// ---------- browser helpers ----------
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--force-color-profile=srgb'] });
await browser.defaultBrowserContext().overridePermissions(CLIENT, ['geolocation']);
const errors = [];
async function page({ app = 'client', token, theme = 'dark', desktop = false }) {
  const p = await browser.newPage();
  p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`));
  await p.setViewport(desktop ? { width: 1440, height: 900, deviceScaleFactor: 2 } : { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: false });
  await p.setGeolocation({ latitude: 10.3157, longitude: 123.8854 });
  const origin = app === 'admin' ? ADMIN : CLIENT;
  await p.goto(origin + '/login');
  await p.evaluate((tok, th, key) => {
    localStorage.clear(); sessionStorage.clear();
    if (tok) localStorage.setItem(key, tok);
    localStorage.setItem(key === 'hunch_token' ? 'hunch_theme' : 'hunch_admin_theme', th);
  }, token || '', theme, app === 'admin' ? 'hunch_admin_token' : 'hunch_token');
  p.origin = origin;
  return p;
}
const go = async (p, route, ms = 1800) => { await p.goto(p.origin + route); await wait(ms); };
const click = async (p, sel, i = 0, ms = 900) => { const els = await p.$$(sel); if (!els[i]) throw new Error(`missing ${sel}`); await els[i].evaluate((e) => e.scrollIntoView({ block: 'center' })); await els[i].click(); await wait(ms); };
const clickText = async (p, sel, text, ms = 900) => {
  const ok = await p.$$eval(sel, (els, t) => { const e = els.find((x) => x.textContent.includes(t)); if (e) { e.click(); return true; } return false; }, text);
  if (!ok) throw new Error(`missing "${text}" in ${sel}`);
  await wait(ms);
};
let count = 0;
async function shot(p, folder, name) {
  const dir = path.join(OUT, folder);
  fs.mkdirSync(dir, { recursive: true });
  await p.screenshot({ path: path.join(dir, `${name}.png`) });
  count++;
  console.log(`  ✓ ${folder}/${name}`);
}
async function run(label, fn) {
  if (only && !label.toLowerCase().includes(only.toLowerCase())) return;
  try { await fn(); } catch (e) { console.warn(`  ✗ ${label}: ${e.message}`); }
}

// ---------- Authentication ----------
await run('Authentication', async () => {
  const p = await page({});
  await p.goto(CLIENT + '/login'); await wait(350); await shot(p, 'Authentication', '01 Welcome Screen');
  await wait(1800); await shot(p, 'Authentication', '02 Login Screen');
  await clickText(p, 'button', 'Forgot Password?'); await shot(p, 'Authentication', '03 Password Reset');
  await p.close();
  const k = await page({ token: T.kai });
  await go(k, '/', 2500); await shot(k, 'Authentication', '04 First Time Setup');
  await k.close();
});

// ---------- Timeline ----------
await run('Timeline', async () => {
  const p = await page({ token: T.hans });
  await go(p, '/'); await shot(p, 'Timeline', '01 For You');
  await clickText(p, '.tabs button', 'Friends', 1500); await p.evaluate(() => window.scrollTo(0, 980)); await wait(700); await shot(p, 'Timeline', '02 Friends');
  await go(p, '/?tab=work'); await shot(p, 'Timeline', '03 Work Feed');
  await go(p, '/'); await click(p, '.composer-trigger'); await p.keyboard.type('Team lunch was the best part of today 🍜'); await wait(400); await shot(p, 'Timeline', '04 Post Creation');
  await go(p, `/post/${hike}`, 2200); await shot(p, 'Timeline', '05 Expanded Comments');
  await p.close();
});

// ---------- Stories ----------
await run('Stories', async () => {
  const p = await page({ token: T.hans });
  await go(p, '/'); await p.$$eval('.story-card.add span[style]', (els) => els.at(-1).click()); await wait(800); await p.waitForSelector('.mood-btn', { timeout: 4000 }); await p.type('input[maxlength="200"]', 'Sunset walk after work'); await clickText(p, '.mood-btn', 'Happy', 300); await shot(p, 'Stories', '01 Stories'); await p.keyboard.press('Escape'); await wait(400);
  await go(p, '/'); await click(p, '.story-card:not(.add)', 0, 1300); await shot(p, 'Stories', '02 Story Viewer');
  await p.type('.story-reply input', 'Looks amazing! Save me a seat next time 😄'); await wait(300); await shot(p, 'Stories', '03 Story Replies');
  await p.keyboard.press('Escape'); await wait(400);
  await click(p, '.story-card:not(.add)', 1, 1300); await shot(p, 'Stories', '04 Story Location Tags');
  await p.close();
});

// ---------- Notes ----------
await run('Notes', async () => {
  const p = await page({ token: T.hans });
  await go(p, '/chats'); await shot(p, 'Notes', '01 Notes');
  await click(p, '.n2-item', 0, 700); await p.keyboard.type('Ready for the weekend'); await wait(300); await shot(p, 'Notes', '02 New Cloud Notes Design');
  await click(p, '.nc-emoji', 0, 700); await shot(p, 'Notes', '03 Mood Notes');
  await clickText(p, '.es-moods button', 'Happy', 500);
  await click(p, '.nc-palette', 0, 700); await click(p, '.be-sw', 6, 400); await shot(p, 'Notes', '04 Bubble Editor');
  await p.close();
  const q = await page({ token: T.hans });
  await go(q, '/chats'); await clickText(q, '.n2-item', 'Gia', 900); await shot(q, 'Notes', '05 Notes Viewer');
  await q.close();
});

// ---------- Chat ----------
await run('Chat', async () => {
  const p = await page({ token: T.hans });
  await go(p, '/chats'); await p.evaluate(() => window.scrollTo(0, 150)); await wait(300); await shot(p, 'Chat', '01 Chat');
  await go(p, `/chats/${dmIris}`, 2200); await shot(p, 'Chat', '02 Private Chat');
  await go(p, `/chats/${group}`, 2200); await shot(p, 'Chat', '03 Group Chat');
  await go(p, `/chats/${group}/info`, 2200); await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await wait(600); await shot(p, 'Chat', '04 Group Settings');
  await go(p, `/chats/${group}`, 2200); await click(p, '.pinned-bar', 0, 900); await shot(p, 'Chat', '05 Pinned Messages');
  await go(p, `/chats/${group}/info`, 2200); await shot(p, 'Chat', '06 Chat Streak');
  await p.close();
});

// ---------- Profile ----------
await run('Profile', async () => {
  const p = await page({ token: T.hans });
  await go(p, `/u/${hansId}`); await shot(p, 'Profile', '01 Personal Profile');
  await go(p, `/u/${jomar}`); await shot(p, 'Profile', '02 Friend Profile');
  await go(p, `/u/${hansId}`); await p.evaluate(() => window.scrollTo(0, 520)); await wait(600); await shot(p, 'Profile', '03 Posts Tab');
  await go(p, `/u/${hansId}`); await clickText(p, '.profile-tabs button', 'Reposts', 1200); await p.evaluate(() => window.scrollTo(0, 520)); await wait(500); await shot(p, 'Profile', '04 Reposts Tab');
  await go(p, `/u/${hansId}`); await click(p, '.highlight', 1, 1200); await shot(p, 'Profile', '05 Highlights Section');
  await p.close();
});

// ---------- Map ----------
await run('Map', async () => {
  // A real trip for Hans so route + traffic screens show live data; ended afterwards.
  const trip = await apiAs(T.hans, '/trips', { method: 'POST', body: { mode: 'car', origin: { name: 'SM Seaside City Cebu', lat: 10.2817, lng: 123.8807 }, dest: { name: 'Cebu IT Park', lat: 10.3302, lng: 123.9063 }, shared: false } });
  const p = await page({ token: T.hans });
  try {
    await apiAs(T.hans, `/trips/${trip.id}/end`, { method: 'POST' }); // keep main map clean first
    await go(p, '/map', 4000); await shot(p, 'Map', '01 Main Map Interface');
    await p.evaluate(() => document.querySelector('.pin-story').closest('.leaflet-marker-icon').click()); await wait(1600); await shot(p, 'Map', '02 Location Stories');
    await clickText(p, '.mp-actions button', 'Friends', 1500); await shot(p, 'Map', '05 Friend Location Sharing');
    const t2 = await apiAs(T.hans, '/trips', { method: 'POST', body: { mode: 'car', origin: { name: 'SM Seaside City Cebu', lat: 10.2817, lng: 123.8807 }, dest: { name: 'Cebu IT Park', lat: 10.3302, lng: 123.9063 }, shared: false } });
    await go(p, '/map', 4000); await click(p, '.mp-grab', 0, 900); await p.evaluate(() => document.querySelectorAll('.pin-story').forEach((e) => e.closest('.leaflet-marker-icon').style.opacity = '1')); await shot(p, 'Map', '03 Route Navigation');
    await clickText(p, '.mp-actions button', 'My Trip', 1200); await shot(p, 'Map', '04 Traffic Monitoring');
    await apiAs(T.hans, `/trips/${t2.id}/end`, { method: 'POST' });
  } finally { await p.close(); }
});

// ---------- Work ----------
await run('Work', async () => {
  const p = await page({ token: T.tristan });
  await go(p, '/?tab=work'); await shot(p, 'Work', '01 Team Timeline');
  await clickText(p, '.chip-row button', 'Announcements', 1300); await shot(p, 'Work', '02 Team Announcement');
  await clickText(p, '.work-views button', 'Schedule', 1300); await shot(p, 'Work', '03 Team Schedule');
  await clickText(p, '.wk-seg button', 'Month', 1200); await p.evaluate(() => document.querySelector('.wk-cal').scrollIntoView()); await wait(400); await shot(p, 'Work', '04 Team Calendar');
  await p.close();
});

// ---------- Settings ----------
await run('Settings', async () => {
  const p = await page({ token: T.hans });
  for (const [route, name] of [['/settings', '01 Main Settings'], ['/settings/privacy', '02 Privacy'], ['/settings/account', '03 Account'], ['/settings/notifications', '04 Notifications'], ['/settings/appearance', '05 Appearance']]) {
    await go(p, route, 1500); await shot(p, 'Settings', name);
  }
  await p.close();
});

// ---------- Admin Dashboard (developer view) ----------
await run('Admin', async () => {
  const p = await page({ app: 'admin', token: T.samA, desktop: true });
  await go(p, '/', 2500); await shot(p, 'Admin Dashboard', '01 Statistics Dashboard');
  await go(p, `/reports/${tristanId}`, 2500); await shot(p, 'Admin Dashboard', '02 Team Reports');
  await go(p, '/workspace', 1500); await p.select('.page-head select', String(tristanId)); await wait(2200); await shot(p, 'Admin Dashboard', '03 Mood Analytics');
  await go(p, '/email', 2000); await click(p, '.mail-row, .email-row, .list-row', 0, 1200).catch(() => {}); await shot(p, 'Admin Dashboard', '04 Email System');
  await go(p, '/register', 2000); await shot(p, 'Admin Dashboard', '05 User Registration');
  await go(p, '/notifications', 2000); await shot(p, 'Admin Dashboard', '06 Notifications');
  await p.close();
});

// ---------- POV ----------
await run('POV User', async () => {
  // Agent view in light mode (the category folders above use dark mode).
  const p = await page({ token: T.hans, theme: 'light' });
  await go(p, '/'); await shot(p, 'POV/User', '01 Timeline');
  await go(p, `/chats/${dmIris}`, 2200); await shot(p, 'POV/User', '02 Chat');
  await go(p, '/chats'); await shot(p, 'POV/User', '03 Notes');
  await go(p, '/'); await click(p, '.story-card:not(.add)', 2, 1300); await shot(p, 'POV/User', '04 Stories');
  await go(p, '/map', 4000); await shot(p, 'POV/User', '05 Map');
  await go(p, `/u/${hansId}`); await shot(p, 'POV/User', '06 Profile');
  await p.close();
});
await run('POV Team Leader', async () => {
  const p = await page({ token: T.tristan, theme: 'light' });
  await go(p, '/?tab=work'); await shot(p, 'POV/Team Leader', '01 Team Feed');
  await go(p, '/?tab=work&view=schedule'); await clickText(p, '.wk-add', 'Add', 1000); await shot(p, 'POV/Team Leader', '02 Team Schedule');
  await go(p, '/?tab=work'); await clickText(p, '.work-views button', 'Team', 1500); await shot(p, 'POV/Team Leader', '03 Team Management');
  await p.close();
  const a = await page({ app: 'admin', token: T.tristanA, desktop: true });
  await go(a, '/workspace', 2500); await clickText(a, '.tabs button', 'Members', 1500); await shot(a, 'POV/Team Leader', '04 Workspace Dashboard');
  await a.close();
});
await run('POV SME', async () => {
  const p = await page({ token: T.lea });
  await go(p, '/?tab=work'); await clickText(p, '.work-views button', 'Mood', 2000); await shot(p, 'POV/SME', '01 Team View');
  await p.close();
  const a = await page({ app: 'admin', token: T.leaA, desktop: true });
  await go(a, '/reports', 2500); await shot(a, 'POV/SME', '02 Reports');
  await go(a, '/', 2500); await shot(a, 'POV/SME', '03 Analytics');
  await a.close();
});
await run('POV Manager', async () => {
  const a = await page({ app: 'admin', token: T.mariaA, desktop: true });
  await go(a, '/reports', 2500); await shot(a, 'POV/Manager', '01 Team Overview');
  await go(a, '/reports', 2000); await clickText(a, 'table tbody tr', 'Nina', 2200).catch(async () => go(a, '/reports', 1500)); await shot(a, 'POV/Manager', '02 Reports');
  await go(a, '/', 2500); await a.evaluate(() => window.scrollTo(0, 560)); await wait(700); await shot(a, 'POV/Manager', '03 Mood Statistics');
  await a.close();
});
await run('POV Developer', async () => {
  const a = await page({ app: 'admin', token: T.samA, desktop: true });
  await go(a, '/', 2500); await a.evaluate(() => window.scrollTo(0, 1100)); await wait(700); await shot(a, 'POV/Developer', '01 Dashboard');
  await go(a, '/users', 2000); await a.select('label.f select', 'tl'); await wait(1500); await shot(a, 'POV/Developer', '02 User Management');
  await go(a, '/settings', 2200); await shot(a, 'POV/Developer', '03 System Analytics');
  await a.close();
});

await browser.close();
console.log(`\n${count} screenshots saved to marketing/Product Screenshots`);
if (errors.length) console.log('Page errors:\n' + errors.join('\n'));
