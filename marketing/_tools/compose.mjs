// Renders Hunch marketing assets from the real screenshots in Marketing/Product Screenshots.
// Usage:  node compose.mjs [filter]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME, MARKETING } from './config.mjs';

const SHOTS = path.join(MARKETING, 'Product Screenshots');
const only = process.argv[2];
const img = (rel) => {
  const p = path.join(SHOTS, `${rel}.png`);
  if (!fs.existsSync(p)) throw new Error(`Missing screenshot: ${rel}`);
  return 'file://' + p.split(path.sep).map(encodeURIComponent).join('/');
};
const LOGO = (color = '#fff', h = 100) => `<svg viewBox="420 240 1090 1460" height="${h}" style="width:auto;display:block"><path d="M465 275H575A262 262 0 0 1 837 537V1656H755A290 290 0 0 1 465 1366Z" fill="${color}"/><path d="M837 859H925A160 160 0 0 1 1085 1019V1440" fill="none" stroke="${color}" stroke-width="9"/><circle cx="1274" cy="1460" r="194" fill="${color}"/></svg>`;

// ---------- building blocks (1rem = 10px at 1080px wide) ----------
const phone = (rel, { w = 36, light = false, tilt = 0, z = 1, shift = 0 } = {}) => `
  <div class="phone ${light ? 'light' : ''}" style="--pw:${w}rem;transform:translateY(${shift}rem) rotate(${tilt}deg);z-index:${z}">
    <div class="screen"><div class="sb"><b>9:41</b><span class="sbi"><i></i><i></i><i></i><em></em></span></div><img src="${img(rel)}"></div>
  </div>`;
const browser = (rel, { w = 90, light = false } = {}) => `
  <div class="browser ${light ? 'light' : ''}" style="--bw:${w}rem"><div class="bar"><i></i><i></i><i></i><span>hunch.app/admin</span></div><img src="${img(rel)}"></div>`;
const label = (t) => `<div class="chiplabel">${t}</div>`;

const CSS = (W, H, theme) => `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:${(W / 1080) * 10}px}
body{width:${W}px;height:${H}px;overflow:hidden;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;position:relative;
  background:${theme === 'light' ? '#f4f5f7' : '#050506'};color:${theme === 'light' ? '#0c0c0e' : '#fff'}}
.glow{position:absolute;inset:0;pointer-events:none;background:
  radial-gradient(60rem 50rem at 85% 15%, rgba(91,141,239,${theme === 'light' ? '.18' : '.28'}), transparent 70%),
  radial-gradient(50rem 40rem at 10% 95%, rgba(167,139,250,${theme === 'light' ? '.14' : '.18'}), transparent 70%)}
.grain{position:absolute;inset:0;opacity:.05;background-image:radial-gradient(#fff 1px,transparent 1px);background-size:.6rem .6rem;pointer-events:none}
.phone{width:var(--pw);aspect-ratio:390/891;border-radius:calc(var(--pw)*.155);background:#0d0d0f;padding:calc(var(--pw)*.028);position:relative;flex-shrink:0;
  box-shadow:0 5rem 9rem rgba(0,0,0,.55),0 1.2rem 2.4rem rgba(0,0,0,.35),inset 0 0 0 .25rem #2b2b30,inset 0 0 0 .5rem #000}
.phone .screen{width:100%;height:100%;border-radius:calc(var(--pw)*.13);overflow:hidden;background:#000;display:flex;flex-direction:column;position:relative}
.phone.light .screen{background:#fafafa}
.phone .screen img{width:100%;display:block;flex:1;object-fit:cover;object-position:top}
.phone .sb{height:calc(var(--pw)*.12);flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 calc(var(--pw)*.085);color:#fff;font-size:calc(var(--pw)*.04);font-weight:700}
.phone.light .sb{color:#111}
.phone .sb::after{content:'';position:absolute;left:50%;top:calc(var(--pw)*.03);transform:translateX(-50%);width:30%;height:calc(var(--pw)*.082);border-radius:99px;background:#000}
.sbi{display:flex;gap:calc(var(--pw)*.012);align-items:flex-end}
.sbi i{width:calc(var(--pw)*.009);background:currentColor;border-radius:1px}
.sbi i:nth-child(1){height:calc(var(--pw)*.018)}.sbi i:nth-child(2){height:calc(var(--pw)*.026)}.sbi i:nth-child(3){height:calc(var(--pw)*.034)}
.sbi em{width:calc(var(--pw)*.06);height:calc(var(--pw)*.03);border:calc(var(--pw)*.004) solid currentColor;border-radius:calc(var(--pw)*.01);margin-left:calc(var(--pw)*.012);position:relative}
.sbi em::after{content:'';position:absolute;inset:calc(var(--pw)*.004);right:calc(var(--pw)*.014);background:currentColor;border-radius:1px}
.browser{width:var(--bw);border-radius:1.8rem;overflow:hidden;background:#16161a;box-shadow:0 5rem 10rem rgba(0,0,0,.55),inset 0 0 0 .2rem #2b2b30;flex-shrink:0}
.browser .bar{height:3.6rem;display:flex;align-items:center;gap:.8rem;padding:0 1.6rem;background:#1d1d22}
.browser .bar i{width:1.1rem;height:1.1rem;border-radius:50%;background:#ff5f57}.browser .bar i:nth-child(2){background:#febc2e}.browser .bar i:nth-child(3){background:#28c840}
.browser .bar span{margin-left:1.6rem;font-size:1.25rem;color:#8a8a93;background:#121215;padding:.4rem 1.6rem;border-radius:.8rem}
.browser img{width:100%;display:block}
.brand{display:flex;align-items:center;gap:1.4rem;font-weight:800;font-size:2.6rem;letter-spacing:-.02em}
.eyebrow{font-size:1.7rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#7da2ff}
h1{font-size:8rem;line-height:.98;font-weight:900;letter-spacing:-.045em}
h1 em{font-style:normal;background:linear-gradient(100deg,#8fb0ff,#5b8def 45%,#b39dfc);-webkit-background-clip:text;color:transparent}
.sub{font-size:3rem;line-height:1.25;font-weight:600;color:${theme === 'light' ? '#3d3d45' : '#c9c9d1'};letter-spacing:-.01em}
.tag{font-size:2.2rem;font-weight:700;letter-spacing:.04em;color:${theme === 'light' ? '#5b5b66' : '#9a9aa6'}}
.chiplabel{display:inline-flex;align-items:center;gap:.8rem;padding:1rem 1.8rem;border-radius:99px;font-size:1.9rem;font-weight:700;
  background:${theme === 'light' ? '#fff' : 'rgba(255,255,255,.08)'};border:.15rem solid ${theme === 'light' ? '#e5e6ea' : 'rgba(255,255,255,.12)'};backdrop-filter:blur(10px)}
.cta{display:inline-flex;align-items:center;gap:1rem;padding:1.6rem 3rem;border-radius:99px;background:#5b8def;color:#fff;font-weight:800;font-size:2.2rem}
.foot{position:absolute;left:6rem;right:6rem;bottom:5rem;display:flex;justify-content:space-between;align-items:center}
`;

async function render(page, file, W, H, theme, body) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS(W, H, theme)}</style></head><body><div class="glow"></div><div class="grain"></div>${body}</body></html>`;
  const tmp = path.join(MARKETING, '_tools', '.render.html');
  fs.writeFileSync(tmp, html);
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto('file://' + tmp, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  return file;
}

// ---------- social-style ad: adapts to 1:1, 4:5 and 9:16 ----------
function adBody(W, H, { eyebrow, headline, sub, tagline, visual, theme }) {
  const square = W / H > 0.95;
  const story = H / W > 1.6;
  const logoCol = theme === 'light' ? '#0c0c0e' : '#fff';
  const text = `
    <div class="brand">${LOGO(logoCol, story ? 46 : 40)}Hunch</div>
    <div style="margin-top:${story ? 6 : 4}rem">${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}
      <h1 style="margin-top:2rem;font-size:${square ? 6.6 : story ? 9 : 8}rem">${headline}</h1>
      ${sub ? `<p class="sub" style="margin-top:2.6rem;font-size:${square ? 2.6 : 3.1}rem">${sub}</p>` : ''}
      ${tagline ? `<p class="tag" style="margin-top:2.4rem">${tagline}</p>` : ''}</div>`;
  if (square) {
    return `<div style="position:absolute;inset:0;display:flex;padding:6rem;gap:3rem;align-items:center">
      <div style="flex:0 0 44%;align-self:stretch;display:flex;flex-direction:column;justify-content:center">${text}</div>
      <div style="flex:1;display:flex;justify-content:center;align-items:center;gap:2rem;height:100%">${visual('square')}</div></div>`;
  }
  return `<div style="position:absolute;inset:0;display:flex;flex-direction:column;padding:${story ? '9rem 7rem 0' : '7rem 7rem 0'}">
    ${text}
    <div style="flex:1;display:flex;justify-content:center;align-items:${story ? 'center' : 'flex-start'};gap:2.4rem;margin-top:${story ? 2 : 5}rem;position:relative">${visual(story ? 'story' : 'portrait')}</div></div>`;
}
const SIZES = [['1080x1080', 1080, 1080], ['1080x1350', 1080, 1350], ['1080x1920', 1080, 1920]];
// Phone width per layout so devices always fit.
const pw = (k, a, b, c) => ({ square: a, portrait: b, story: c }[k]);

// ---------- asset definitions ----------
const SOCIAL = [
  { slug: 'Concept 1 Connect Through Moods', theme: 'dark', eyebrow: 'Connect through moods', headline: 'Every Mood<br>Has A Story.', sub: 'Share yours on <b style="color:#fff">Hunch</b>.', tagline: 'Connect. Express. Belong.',
    visual: (k) => `${phone('Timeline/01 For You', { w: pw(k, 27, 36, 56), tilt: -4, z: 2 })}${k !== 'square' ? `<div style="position:absolute;right:${k === 'story' ? 4 : 3}rem;bottom:${k === 'story' ? 18 : 6}rem;z-index:3">${phone('Notes/05 Notes Viewer', { w: pw(k, 0, 24, 34), tilt: 6 })}</div>` : ''}` },
  { slug: 'Concept 2 Social and Work', theme: 'dark', eyebrow: 'Social + work in one app', headline: 'One App.<br>Personal Life.<br><em>Work Life.</em>', sub: 'Seamlessly connected.',
    visual: (k) => `<div style="display:flex;flex-direction:column;align-items:center;gap:2rem">${label('Personal Feed')}${phone('Timeline/01 For You', { w: pw(k, 21, 30, 45) })}</div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:2rem">${label('🔒 Work Feed')}${phone('Work/01 Team Timeline', { w: pw(k, 21, 30, 45) })}</div>` },
  { slug: 'Concept 3 Map Experience', theme: 'dark', eyebrow: 'Hunch Map', headline: 'Discover Moments<br><em>Around You.</em>', sub: 'Explore stories through places.',
    visual: (k) => `${phone('Map/02 Location Stories', { w: pw(k, 27, 36, 56), tilt: -3, z: 2 })}${k !== 'square' ? `<div style="position:absolute;right:2rem;bottom:${k === 'story' ? 16 : 4}rem;z-index:3">${phone('Map/04 Traffic Monitoring', { w: pw(k, 0, 24, 34), tilt: 5 })}</div>` : ''}` },
  { slug: 'Concept 4 Cloud Notes', theme: 'light', eyebrow: 'Notes', headline: 'Small Thoughts.<br><em>Big Connections.</em>', sub: 'Share a quick note with friends. It disappears in 24 hours.',
    visual: (k) => `${phone('POV/User/03 Notes', { w: pw(k, 27, 36, 56), light: true, z: 2 })}` },
  { slug: 'Concept 5 Team Engagement', theme: 'dark', eyebrow: 'For team leaders', headline: 'Build Stronger Teams<br><em>Through Better Connections.</em>', sub: 'Team mood, schedules and announcements in one workspace.',
    visual: (k) => k === 'square'
      ? `${phone('POV/SME/01 Team View', { w: 26 })}`
      : `<div style="position:absolute;left:-14rem;top:${k === 'story' ? 6 : 2}rem">${browser('Admin Dashboard/03 Mood Analytics', { w: k === 'story' ? 116 : 84 })}</div>
         <div style="position:absolute;right:4rem;top:${k === 'story' ? 30 : 18}rem;z-index:3">${phone('POV/SME/01 Team View', { w: k === 'story' ? 48 : 32 })}</div>` },
];

const FEATURE = [
  { dir: 'Team Workspace Ads', slug: 'Team Workspace', eyebrow: 'Work feed', headline: 'Your Team.<br><em>One Workspace.</em>', sub: 'Announcements, schedules and a private team feed that only your team can see.',
    visual: (k) => `${phone('Work/01 Team Timeline', { w: pw(k, 0, 31, 46), tilt: -3, z: 2 })}${phone('Work/04 Team Calendar', { w: pw(k, 0, 31, 46), tilt: 3, shift: 6 })}` },
  { dir: 'Location Map Ads', slug: 'Location Map', eyebrow: 'Hunch Map', headline: 'Every Place<br><em>Has A Story.</em>', sub: 'Story pins, friend locations and live routes with traffic colours. Private by default.',
    visual: (k) => `${phone('Map/01 Main Map Interface', { w: pw(k, 0, 31, 46), tilt: -3, z: 2 })}${phone('Map/03 Route Navigation', { w: pw(k, 0, 31, 46), tilt: 3, shift: 6 })}` },
  { dir: 'Mood Analytics Ads', slug: 'Mood Analytics', eyebrow: 'Mood analytics', headline: 'See How Your<br><em>Team Really Feels.</em>', sub: 'Daily team mood, weekly trends and early burnout signals, built from simple check-ins.',
    visual: (k) => `<div style="position:absolute;left:-12rem;top:${k === 'story' ? 4 : 0}rem">${browser('Admin Dashboard/03 Mood Analytics', { w: k === 'story' ? 116 : 88 })}</div><div style="position:absolute;right:3rem;top:${k === 'story' ? 36 : 20}rem;z-index:2">${phone('POV/SME/01 Team View', { w: k === 'story' ? 48 : 30 })}</div>` },
  { dir: 'Highlight Ads', slug: 'Highlights', eyebrow: 'Highlights', headline: 'Keep The Moments<br><em>That Matter.</em>', sub: 'Save Mood Stories to your profile. Custom covers, likes, comments and stats.',
    visual: (k) => `${phone('Profile/01 Personal Profile', { w: pw(k, 0, 31, 46), tilt: -3, z: 2 })}${phone('Profile/05 Highlights Section', { w: pw(k, 0, 31, 46), tilt: 3, shift: 6 })}` },
  { dir: 'Chat Ads', slug: 'Chat', eyebrow: 'Chat', headline: 'Conversations<br><em>That Keep Going.</em>', sub: 'Private and group chats with reactions, pinned messages and daily streaks.',
    visual: (k) => `${phone('Chat/03 Group Chat', { w: pw(k, 0, 31, 46), tilt: -3, z: 2 })}${phone('Chat/02 Private Chat', { w: pw(k, 0, 31, 46), tilt: 3, shift: 6 })}` },
  { dir: 'Notes Ads', slug: 'Notes', eyebrow: 'Notes', headline: 'Say It<br><em>In A Bubble.</em>', sub: 'Pick an emoji, choose a colour, share a thought. Friends can like and reply.',
    visual: (k) => `${phone('Notes/02 New Cloud Notes Design', { w: pw(k, 0, 31, 46), tilt: -3, z: 2 })}${phone('Notes/05 Notes Viewer', { w: pw(k, 0, 31, 46), tilt: 3, shift: 6 })}` },
  { dir: 'Stories Ads', slug: 'Stories', eyebrow: 'Mood Stories', headline: 'Your Day,<br><em>Your Mood.</em>', sub: 'Mood Stories with photos, places and replies. Gone in 24 hours.',
    visual: (k) => `${phone('Stories/02 Story Viewer', { w: pw(k, 0, 31, 46), tilt: -3, z: 2 })}${phone('Stories/04 Story Location Tags', { w: pw(k, 0, 31, 46), tilt: 3, shift: 6 })}` },
  { dir: 'Recruitment Ads', slug: 'Careers', eyebrow: 'Careers at Hunch', headline: 'Help Teams<br><em>Feel Heard.</em>', sub: 'We are building the place where work and wellbeing meet. Join us.', cta: 'View open roles',
    visual: (k) => `${phone('POV/User/01 Timeline', { w: pw(k, 0, 28, 38), light: true, tilt: -5 })}${phone('Work/03 Team Schedule', { w: pw(k, 0, 28, 38), shift: 5, z: 2 })}${phone('Notes/01 Notes', { w: pw(k, 0, 28, 38), tilt: 5 })}` },
];

const POSTERS = [
  { slug: 'Poster 1 Welcome to Hunch', title: 'WELCOME<br>TO HUNCH', sub: 'Timeline. Notes. Stories. Messaging.', shots: ['Timeline/01 For You', 'Notes/01 Notes', 'Stories/02 Story Viewer', 'Chat/03 Group Chat'] },
  { slug: 'Poster 2 More Than Social', title: 'MORE<br>THAN SOCIAL', sub: 'Work feed. Team calendar. Reports. Team connection.', shots: ['Work/01 Team Timeline', 'Work/04 Team Calendar', 'POV/SME/01 Team View', 'POV/Team Leader/03 Team Management'] },
  { slug: 'Poster 3 Your World on the Map', title: 'YOUR WORLD<br>ON THE MAP', sub: 'Location stories. Navigation. Live routes.', shots: ['Map/01 Main Map Interface', 'Map/02 Location Stories', 'Map/04 Traffic Monitoring'] },
  { slug: 'Poster 4 Where Moods Meet Connections', title: 'WHERE MOODS<br>MEET CONNECTIONS', sub: 'Notes. Mood tracking. Timeline.', shots: ['Notes/05 Notes Viewer', 'Notes/03 Mood Notes', 'Timeline/02 Friends'] },
];

const MAGAZINE = [
  { slug: 'Spread 1 Timeline Experience', feature: 'Timeline Experience', headline: 'Share What Matters.', shot: 'Timeline/01 For You', side: 'Timeline/05 Expanded Comments',
    body: 'Posts, photos and threaded replies from the people you work and live with. For You brings the whole community together, Friends keeps it close, and Work keeps your team in sync.',
    points: ['For You, Friends and Work feeds', 'Threads-style conversations', 'Daily mood check-in'] },
  { slug: 'Spread 2 Cloud Notes', feature: 'Cloud Notes', headline: 'Thoughts Floating Across Connections.', shot: 'Notes/01 Notes', side: 'Notes/04 Bubble Editor',
    body: 'A note is the lightest way to say how you are. Add an emoji, pick a bubble colour and share it with friends for 24 hours. They can like it or reply privately.',
    points: ['Emoji stickers and bubble colours', 'Likes and private replies', 'Mood-aware, never noisy'] },
  { slug: 'Spread 3 Map and Discovery', feature: 'Map and Discovery', headline: 'Every Place Has A Story.', shot: 'Map/02 Location Stories', side: 'Map/04 Traffic Monitoring',
    body: 'See the stories your friends tag around the city, share where you are when you choose to, and plan a route with estimated traffic. Your location stays private unless you turn it on.',
    points: ['Location story pins', 'Routes with traffic colours', 'Private by default'] },
  { slug: 'Spread 4 Work Feed', feature: 'Work Feed', headline: 'Where Teams Stay Connected.', shot: 'Work/01 Team Timeline', side: 'Work/03 Team Schedule',
    body: 'Every team gets its own space for announcements, schedules and updates. Team leaders manage posting, coaching sessions and shifts, and see how the team is feeling each day.',
    points: ['Team-only feed and pinned posts', 'Shifts, meetings and coaching', 'Daily team mood and burnout signals'] },
];

// ---------- run ----------
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--allow-file-access-from-files', '--force-color-profile=srgb'] });
const page = await b.newPage();
let n = 0;
const want = (s) => !only || s.toLowerCase().includes(only.toLowerCase());
const out = (...p) => path.join(MARKETING, ...p);
const done = (f) => { n++; console.log('  ✓', path.relative(MARKETING, f)); };

for (const ad of SOCIAL) {
  if (!want('social ' + ad.slug)) continue;
  for (const [s, W, H] of SIZES) done(await render(page, out('Social Media Ads', ad.slug, `${ad.slug} ${s}.png`), W, H, ad.theme, adBody(W, H, ad)));
}
for (const f of FEATURE) {
  if (!want(f.dir)) continue;
  for (const [s, W, H] of SIZES.slice(1)) {
    const body = adBody(W, H, { ...f, theme: 'dark', visual: f.visual, tagline: f.cta ? `<span class="cta">${f.cta} →</span>` : '' });
    done(await render(page, out(f.dir, `${f.slug} ${s}.png`), W, H, 'dark', body));
  }
}
for (const p of POSTERS) {
  if (!want('poster ' + p.slug)) continue;
  const W = 2160, H = 2880;
  const k = p.shots.length;
  const phones = p.shots.map((s, i) => '<div style="margin:0 -2.5rem">' + phone(s, { w: k === 4 ? 24 : 28, tilt: (i - (k - 1) / 2) * 5, shift: Math.abs(i - (k - 1) / 2) * 6, z: 10 - Math.abs(i - (k - 1) / 2) }) + '</div>').join('');
  const body = `<div style="position:absolute;inset:0;padding:9rem 8rem;display:flex;flex-direction:column">
    <div class="brand" style="font-size:3rem">${LOGO('#fff', 46)}Hunch</div>
    <h1 style="margin-top:7rem;font-size:${p.title.length > 30 ? 10.5 : 13}rem;line-height:.92">${p.title.replace(/<br>([^<]*)$/, '<br><em>$1</em>')}</h1>
    <p class="sub" style="margin-top:3rem;font-size:3.4rem">${p.sub}</p>
    <div style="flex:1;display:flex;justify-content:center;align-items:center;gap:0;margin-top:4rem">${phones}</div>
    <div style="position:relative;z-index:20;margin-top:4rem;display:flex;justify-content:space-between;align-items:center;font-size:2.4rem;color:#9a9aa6;font-weight:600"><span>Connect. Express. Belong.</span><span class="cta">Get Hunch</span></div></div>`;
  done(await render(page, out('Posters', `${p.slug}.png`), W, H, 'dark', body));
}
for (const m of MAGAZINE) {
  if (!want('magazine ' + m.slug)) continue;
  const W = 3600, H = 2400; // two facing pages, 3:2 each half
  const body = `<style>html{font-size:${(W / 2 / 1080) * 10}px}</style>
    <div style="position:absolute;left:0;top:0;width:50%;height:100%;display:flex;align-items:center;justify-content:center;background:radial-gradient(80rem 80rem at 50% 45%, rgba(91,141,239,.35), transparent 70%),#08080a">
      <div style="display:flex;align-items:flex-end;gap:0">${phone(m.shot, { w: 58, z: 2 })}<div style="margin-left:-12rem;margin-bottom:-6rem">${phone(m.side, { w: 40, tilt: 6 })}</div></div></div>
    <div style="position:absolute;left:50%;top:0;width:50%;height:100%;padding:16rem 14rem;display:flex;flex-direction:column;background:#f6f6f8;color:#0c0c0e">
      <div class="brand" style="color:#0c0c0e">${LOGO('#0c0c0e', 44)}Hunch</div>
      <div class="eyebrow" style="margin-top:14rem;color:#4a76db">${m.feature}</div>
      <h1 style="margin-top:3rem;font-size:11rem">${m.headline}</h1>
      <p style="margin-top:5rem;font-size:3.2rem;line-height:1.5;color:#3d3d45;max-width:80rem">${m.body}</p>
      <ul style="margin-top:5rem;list-style:none;display:flex;flex-direction:column;gap:2.2rem">${m.points.map((pt) => `<li style="font-size:3rem;font-weight:700;display:flex;gap:2rem;align-items:center"><span style="width:1.4rem;height:1.4rem;border-radius:50%;background:#5b8def;display:inline-block"></span>${pt}</li>`).join('')}</ul>
      <div style="margin-top:auto;display:flex;justify-content:space-between;align-items:center;font-size:2.6rem;color:#6b6b75;font-weight:600"><span>Connect. Express. Belong.</span><span>hunch.app</span></div></div>
    <div style="position:absolute;left:50%;top:0;bottom:0;width:6rem;transform:translateX(-50%);background:linear-gradient(90deg,transparent,rgba(0,0,0,.18),transparent)"></div>`;
  done(await render(page, out('Magazine Ads', `${m.slug}.png`), W, H, 'dark', body));
}
if (want('showcase')) {
  const W = 3840, H = 2160;
  const hero = `<style>html{font-size:${(W / 1920) * 10}px}</style><div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding-top:9rem">
    <div class="brand" style="font-size:3rem">${LOGO('#fff', 44)}Hunch</div>
    <h1 style="margin-top:3rem;font-size:7.6rem;text-align:center">Connect. Express. <em>Belong.</em></h1>
    <p class="sub" style="margin-top:2rem;font-size:2.6rem">The social and team engagement app for moods, moments and the people you work with.</p>
    <div style="display:flex;align-items:flex-start;margin-top:7rem">${['Notes/01 Notes', 'Timeline/01 For You', 'Map/02 Location Stories', 'Work/01 Team Timeline', 'Chat/03 Group Chat'].map((s, i) => `<div style="margin:0 -2rem">${phone(s, { w: i === 2 ? 34 : 30, tilt: (i - 2) * 4, shift: Math.abs(i - 2) * 5, z: 10 - Math.abs(i - 2) })}</div>`).join('')}</div></div>`;
  done(await render(page, out('App Showcase', 'Hunch App Showcase 3840x2160.png'), W, H, 'dark', hero));
  const pov = (title, role, inner) => `<div style="display:flex;flex-direction:column;align-items:center;gap:2.4rem"><div style="text-align:center"><div class="eyebrow" style="font-size:1.4rem">${role}</div><div style="font-size:2.6rem;font-weight:800;margin-top:.6rem">${title}</div></div>${inner}</div>`;
  const povBody = `<style>html{font-size:${(W / 1920) * 10}px}</style><div style="position:absolute;inset:0;padding:8rem 7rem;display:flex;flex-direction:column">
    <div style="display:flex;justify-content:space-between;align-items:flex-end"><div><div class="brand" style="font-size:2.6rem">${LOGO('#fff', 38)}Hunch</div><h1 style="margin-top:3rem;font-size:6.4rem">One app. <em>Every role.</em></h1></div>
    <p class="sub" style="font-size:2.2rem;max-width:62rem;text-align:right">Agents, team leaders, SMEs, managers and developers each get the view they need, from the same live data.</p></div>
    <div style="flex:1;display:flex;justify-content:space-between;align-items:center;margin-top:5rem">
      ${pov('Timeline, chat and map', 'User', phone('POV/User/01 Timeline', { w: 25, light: true }))}
      ${pov('Team feed and schedules', 'Team Leader', phone('POV/Team Leader/02 Team Schedule', { w: 25, light: true }))}
      ${pov('Team mood view', 'SME', phone('POV/SME/01 Team View', { w: 25 }))}
      <div style="display:flex;flex-direction:column;gap:5rem">${pov('Team overview', 'Manager', browser('POV/Manager/01 Team Overview', { w: 62 }))}${pov('User management', 'Developer', browser('POV/Developer/02 User Management', { w: 62 }))}</div>
    </div></div>`;
  done(await render(page, out('App Showcase', 'Hunch Every Role 3840x2160.png'), W, H, 'dark', povBody));
  const dash = `<style>html{font-size:${(W / 1920) * 10}px}</style><div style="position:absolute;inset:0;padding:8rem;display:flex;flex-direction:column;align-items:center">
    <div class="eyebrow" style="font-size:1.6rem">Admin dashboard</div><h1 style="margin-top:2rem;font-size:6rem;text-align:center">Insight for every team, <em>in real time.</em></h1>
    <div style="margin-top:6rem;position:relative">${browser('Admin Dashboard/01 Statistics Dashboard', { w: 140 })}<div style="position:absolute;right:-8rem;bottom:-6rem">${phone('Work/04 Team Calendar', { w: 26 })}</div></div></div>`;
  done(await render(page, out('App Showcase', 'Hunch Dashboard Showcase 3840x2160.png'), W, H, 'dark', dash));
}
if (want('brand')) {
  const dir = out('Branding Assets');
  fs.mkdirSync(dir, { recursive: true });
  for (const [n2, c] of [['white', '#ffffff'], ['black', '#000000'], ['blue', '#5B8DEF']]) fs.writeFileSync(path.join(dir, `Hunch Logo ${n2}.svg`), LOGO(c, 1460).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace('style="width:auto;display:block"', 'width="1090"'));
  const logoOn = (bg, fg, W, H, h) => `<div style="position:absolute;inset:0;background:${bg};display:grid;place-items:center">${LOGO(fg, h)}</div>`;
  done(await render(page, path.join(dir, 'Hunch Logo White on Black 2048.png'), 2048, 2048, 'dark', logoOn('#000', '#fff', 2048, 2048, 1100)));
  done(await render(page, path.join(dir, 'Hunch Logo Black on White 2048.png'), 2048, 2048, 'light', logoOn('#fff', '#000', 2048, 2048, 1100)));
  done(await render(page, path.join(dir, 'Hunch App Icon 1024.png'), 1024, 1024, 'dark', `<div style="position:absolute;inset:0;background:#000;display:grid;place-items:center;background:radial-gradient(500px 500px at 70% 20%, rgba(91,141,239,.35), transparent 70%),#050506">${LOGO('#fff', 560)}</div>`));
  const W = 3840, H = 2160;
  const sw = (name, hex, dark = true) => `<div style="flex:1;border-radius:2.4rem;overflow:hidden;background:#141416;box-shadow:inset 0 0 0 .2rem #26262a"><div style="height:24rem;background:${hex};${hex === '#000000' ? 'box-shadow:inset 0 0 0 .2rem #2b2b30' : ''}"></div><div style="padding:2.4rem"><div style="font-size:2.4rem;font-weight:800">${name}</div><div style="font-size:1.8rem;color:#9a9aa6;margin-top:.6rem;font-family:ui-monospace,Menlo,monospace">${hex}</div></div></div>`;
  const guide = `<style>html{font-size:${(W / 1920) * 10}px}</style><div style="position:absolute;inset:0;padding:8rem;display:flex;flex-direction:column;gap:6rem">
    <div style="display:flex;justify-content:space-between;align-items:center"><div class="brand" style="font-size:3rem">${LOGO('#fff', 50)}Hunch Brand Guide</div><span class="tag">Connect. Express. Belong.</span></div>
    <div><div class="eyebrow" style="font-size:1.5rem">Colour</div><div style="display:flex;gap:2.4rem;margin-top:2.4rem">${sw('Midnight', '#000000')}${sw('Card', '#1E1E1E')}${sw('Hunch Blue', '#5B8DEF')}${sw('Field', '#D9D9D9')}${sw('White', '#FFFFFF')}${sw('Soft Gray', '#F2F3F5')}</div></div>
    <div style="display:flex;gap:6rem"><div style="flex:1"><div class="eyebrow" style="font-size:1.5rem">Typography</div><div style="font-size:9rem;font-weight:900;letter-spacing:-.04em;margin-top:2rem">Inter</div>
      <div style="font-size:2.4rem;color:#c9c9d1;margin-top:1rem">Headlines Black 900, tight tracking. Body Medium 500. UI Semibold 600.</div>
      <div style="margin-top:3rem;font-size:5rem;font-weight:900;letter-spacing:-.04em">Every Mood Has A Story.</div><div style="font-size:2.6rem;margin-top:1.4rem;color:#c9c9d1">Share yours on Hunch.</div></div>
      <div style="flex:1"><div class="eyebrow" style="font-size:1.5rem">Mood palette</div><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:1.6rem;margin-top:2.4rem">
      ${[['Happy', '#FFC83D'], ['Sad', '#5B8DEF'], ['Angry', '#F2545B'], ['Tired', '#9CA3AF'], ['Excited', '#FF8A3D'], ['Curious', '#2EC4B6'], ['Lazy', '#B39B7D'], ['Sleepy', '#7C8DB5'], ['Energetic', '#3DDC84'], ['Chill', '#A78BFA']].map(([n3, c]) => `<div style="display:flex;align-items:center;gap:1.2rem;font-size:2rem;font-weight:700"><i style="width:2rem;height:2rem;border-radius:50%;background:${c};display:inline-block"></i>${n3}</div>`).join('')}</div>
      <div class="eyebrow" style="font-size:1.5rem;margin-top:5rem">Voice</div><div style="font-size:2.3rem;line-height:1.5;color:#c9c9d1;margin-top:1.6rem">Warm, short and human. Sentences end with full stops. No em dashes. Talk about people and teams, not features.</div></div></div></div>`;
  done(await render(page, path.join(dir, 'Hunch Brand Guide 3840x2160.png'), W, H, 'dark', guide));
}
await b.close();
fs.rmSync(path.join(MARKETING, '_tools', '.render.html'), { force: true });
console.log(`\n${n} assets rendered.`);
