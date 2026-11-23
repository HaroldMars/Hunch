import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import Logo from '@shared/Logo.jsx';
import { ROLE_LABELS } from '@shared/constants.js';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { Avatar, TopBar, Sheet, Confirm, Spinner, Empty, useLoad } from '../components/ui.jsx';

const SECTIONS = [
  { key: 'account', icon: 'user', label: 'Account', sub: 'Profile, password, email, privacy' },
  { key: 'privacy', icon: 'lock', label: 'Privacy', sub: 'Posts, messages, requests, blocked, active status' },
  { key: 'notifications', icon: 'bell', label: 'Notifications', sub: 'Likes, comments, messages, requests, updates' },
  { key: 'appearance', icon: 'moon', label: 'Appearance', sub: 'Light, dark or system default' },
  { key: 'data', icon: 'download', label: 'Data & Storage', sub: 'Media downloads, cache, storage usage' },
  { key: 'help', icon: 'comment', label: 'Help & Support', sub: 'FAQ, contact support, terms, privacy policy' },
  { key: 'about', icon: 'sparkle', label: 'About Hunch', sub: 'Our story, mission and version' },
];

function Row({ icon, label, sub, onClick, right, danger }) {
  return (
    <button className={`sg-row ${danger ? 'danger' : ''}`} onClick={onClick}>
      {icon && <Icon name={icon} size={21} />}
      <span className="sg-label">{label}{sub && <small>{sub}</small>}</span>
      {right ?? <Icon name="next" size={17} className="chev" />}
    </button>
  );
}
function Toggle({ label, sub, on, onChange }) {
  return (
    <label className="toggle-row">
      <span><b>{label}</b>{sub && <small>{sub}</small>}</span>
      <input type="checkbox" className="switch" checked={!!on} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
function Choice({ label, sub, value, options, onChange }) {
  return (
    <div className="choice">
      <div className="choice-label"><b>{label}</b>{sub && <small>{sub}</small>}</div>
      {options.map(([v, l, d]) => (
        <label key={v} className={`radio-row ${value === v ? 'on' : ''}`}>
          <input type="radio" checked={value === v} onChange={() => onChange(v)} />
          <span><b>{l}</b>{d && <small>{d}</small>}</span>
          <i />
        </label>
      ))}
    </div>
  );
}
const Group = ({ title, children }) => <div className="settings-group">{title && <div className="sg-title">{title}</div>}{children}</div>;

export default function Settings() {
  const { section } = useParams();
  const meta = SECTIONS.find((s) => s.key === section);
  if (section && !meta) return <div className="page"><TopBar title="Settings" back /><Empty icon="settings" title="Not found" /></div>;
  return (
    <div className="page">
      <TopBar title={meta ? meta.label : 'Settings'} back />
      {!meta && <Home />}
      {section === 'account' && <Account />}
      {section === 'privacy' && <Privacy />}
      {section === 'notifications' && <Notifications />}
      {section === 'appearance' && <Appearance />}
      {section === 'data' && <DataStorage />}
      {section === 'help' && <Help />}
      {section === 'about' && <About />}
    </div>
  );
}

function Home() {
  const { user, logout } = useApp();
  const nav = useNavigate();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <button className="settings-me" onClick={() => nav(`/u/${user.id}`)}>
        <Avatar user={user} size={52} />
        <span><b>{user.full_name}</b><small>{user.email} · {ROLE_LABELS[user.role]}</small></span>
        <Icon name="next" size={17} />
      </button>
      <Group>
        {SECTIONS.map((s) => <Row key={s.key} icon={s.icon} label={s.label} sub={s.sub} onClick={() => nav(`/settings/${s.key}`)} />)}
      </Group>
      <Group><Row icon="logout" label="Sign out" danger right={<span />} onClick={() => setConfirm(true)} /></Group>
      {confirm && <Confirm title="Sign out of Hunch?" confirmLabel="Sign out" onClose={() => setConfirm(false)} onConfirm={logout} message="You can sign back in any time with your email and password." />}
    </>
  );
}

function Account() {
  const { user, session, setSession, toast, logout } = useApp();
  const nav = useNavigate();
  const [sheet, setSheet] = useState(null);
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState('');
  const setPrivacy = async (privacy) => {
    setSession({ ...session, user: await api('/users/me', { method: 'PATCH', body: { privacy } }) });
    toast(privacy === 'public' ? 'Your account is now public' : 'Your account is now friends-only', 'success');
  };
  const changeEmail = async () => {
    setErr('');
    try {
      const s = await api('/users/me/email', { method: 'PATCH', body: f });
      toast('Email updated. Verify the new address', 'success');
      setSession(s); // next: verify → onboarding screen sends a code
    } catch (e) { setErr(e.message); }
  };
  const deactivate = async () => {
    setErr('');
    try { await api('/users/me/deactivate', { method: 'POST', body: { password: f.password } }); logout(); } catch (e) { setErr(e.message); }
  };
  return (
    <>
      <Group title="Account">
        <Row icon="user" label="Profile information" sub="Name, photo, bio, job title, location" onClick={() => nav('/edit-profile')} />
        <Row icon="key" label="Change password" onClick={() => nav('/change-password')} />
        <Row icon="mail" label="Change email" sub={user.email} onClick={() => { setF({ email: '', password: '' }); setErr(''); setSheet('email'); }} />
      </Group>
      <Group title="Account privacy">
        <Choice value={user.privacy} onChange={setPrivacy} options={[
          ['public', 'Public', 'Anyone on Hunch can see your profile, posts and highlights.'],
          ['friends', 'Friends only', 'Only people you’ve accepted as friends can see them.'],
        ]} />
      </Group>
      <Group>
        <Row icon="userMinus" label="Deactivate account" sub="Hide your account until an administrator reactivates it" danger onClick={() => { setF({ email: '', password: '' }); setErr(''); setSheet('deactivate'); }} />
      </Group>
      {sheet === 'email' && (
        <Sheet title="Change email" onClose={() => setSheet(null)} footer={<button className="btn block" disabled={!f.email || !f.password} onClick={changeEmail}>Update email</button>}>
          <p className="small muted" style={{ marginTop: 0 }}>You’ll sign in with the new address and need to verify it with a code.</p>
          <label className="label">New email</label><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <label className="label">Current password</label><input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" />
          {err && <div className="error-text">{err}</div>}
        </Sheet>
      )}
      {sheet === 'deactivate' && (
        <Sheet title="Deactivate account" onClose={() => setSheet(null)} footer={<button className="btn danger block" disabled={!f.password} onClick={deactivate}>Deactivate my account</button>}>
          <p style={{ marginTop: 0, color: 'var(--text-2)', lineHeight: 1.5 }}>Your profile, posts and stories will be hidden and you’ll be signed out. Your data is kept. To come back, ask an administrator to reactivate your account.</p>
          <label className="label">Confirm with your password</label><input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          {err && <div className="error-text">{err}</div>}
        </Sheet>
      )}
    </>
  );
}

function Privacy() {
  const { user, session, setSession, prefs, updatePrefs, toast } = useApp();
  const blocks = useLoad(() => api('/blocks'), []);
  const [showBlocked, setShowBlocked] = useState(false);
  if (!prefs) return <Spinner />;
  const save = (patch) => updatePrefs(patch).then(() => toast('Saved')).catch((e) => toast(e.message, 'error'));
  return (
    <>
      <Group title="Who can view your posts">
        <Choice value={user.privacy} onChange={async (privacy) => { setSession({ ...session, user: await api('/users/me', { method: 'PATCH', body: { privacy } }) }); toast('Saved'); }} options={[
          ['public', 'Everyone', 'Your posts appear in For You for everyone.'], ['friends', 'Friends only', 'Only friends see your posts, stories and highlights.']]} />
      </Group>
      <Group title="Who can message you">
        <Choice value={prefs.message_privacy} onChange={(v) => save({ message_privacy: v })} options={[
          ['friends', 'Friends', 'Accepted friends can message you.'], ['nobody', 'No one', 'Pause new private messages. Group chats still work.']]} />
      </Group>
      <Group title="Who can send you friend requests">
        <Choice value={prefs.friend_requests} onChange={(v) => save({ friend_requests: v })} options={[
          ['everyone', 'Everyone'], ['mutuals', 'Friends of friends'], ['nobody', 'No one']]} />
      </Group>
      <Group title="Location">
        <Choice value={prefs.location_sharing} onChange={(v) => save({ location_sharing: v })} options={[
          ['friends', 'Friends', 'Friends can see your shared location, the places on your stories and your live position on trips you share. Your route and destination are always private.'],
          ['private', 'Private', 'Nobody sees your location, tagged places or movement. Anything already shared is removed.']]} />
      </Group>
      <Group title="Active status">
        <Toggle label="Show when you’re active" sub="Friends see a green dot when you’re online." on={prefs.show_active} onChange={(v) => save({ show_active: v })} />
      </Group>
      <Group>
        <Row icon="userMinus" label="Blocked users" sub={blocks.data ? `${blocks.data.length} blocked` : '…'} onClick={() => setShowBlocked(true)} />
      </Group>
      {showBlocked && (
        <Sheet title="Blocked users" onClose={() => setShowBlocked(false)}>
          {!blocks.data ? <Spinner /> : !blocks.data.length ? <Empty icon="shield" title="No one blocked">People you block can’t see your profile or message you.</Empty> : blocks.data.map((b) => (
            <div key={b.id} className="row-item">
              <Avatar user={b} size={40} />
              <div className="meta"><div className="title">{b.full_name}</div><div className="sub">{b.user_code}</div></div>
              <button className="btn ghost sm" onClick={async () => { await api(`/users/${b.id}/block`, { method: 'DELETE' }); toast(`Unblocked ${b.full_name}`); blocks.reload(); }}>Unblock</button>
            </div>
          ))}
        </Sheet>
      )}
    </>
  );
}

function Notifications() {
  const { prefs, updatePrefs } = useApp();
  if (!prefs) return <Spinner />;
  const set = (k) => (v) => updatePrefs({ notify: { [k]: v } });
  return (
    <Group title="Push me about">
      <Toggle label="Likes" sub="Likes and reactions on your posts, comments and stories" on={prefs.notify.likes} onChange={set('likes')} />
      <Toggle label="Comments" sub="Comments, replies and @mentions" on={prefs.notify.comments} onChange={set('comments')} />
      <Toggle label="Messages" sub="New private and group messages (muted chats stay quiet)" on={prefs.notify.messages} onChange={set('messages')} />
      <Toggle label="Friend requests" sub="New and accepted requests" on={prefs.notify.friend_requests} onChange={set('friend_requests')} />
      <Toggle label="Work feed" sub="Team posts, announcements, schedules and posting permission" on={prefs.notify.work} onChange={set('work')} />
      <Toggle label="Trips" sub="When a friend starts sharing their live position or arrives" on={prefs.notify.trips} onChange={set('trips')} />
      <Toggle label="App updates" sub="New features from the Hunch team" on={prefs.notify.app_updates} onChange={set('app_updates')} />
      <p className="small muted" style={{ margin: '10px 2px 0' }}>System announcements from your administrators are always delivered.</p>
    </Group>
  );
}

function Appearance() {
  const { theme, setTheme } = useApp();
  return (
    <Group title="Theme">
      <Choice value={theme} onChange={setTheme} options={[
        ['light', 'Light mode'], ['dark', 'Dark mode', 'The classic black Hunch look.'], ['system', 'System default', 'Match your device’s setting automatically.']]} />
    </Group>
  );
}

const fmtBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
function DataStorage() {
  const { prefs, updatePrefs, toast } = useApp();
  const storage = useLoad(() => api('/users/me/storage'), []);
  const [local, setLocal] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const measure = () => navigator.storage?.estimate?.().then((e) => setLocal(e.usage || 0)).catch(() => setLocal(null));
  useEffect(() => { measure(); }, []);
  if (!prefs) return <Spinner />;
  const s = storage.data;
  const total = s ? Object.values(s).reduce((a, b) => a + b, 0) : 0;
  const clearCache = async () => {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('hunch_') && !['hunch_token', 'hunch_theme'].includes(k)).forEach((k) => localStorage.removeItem(k));
      if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    } catch { /* storage unavailable */ }
    toast('Cache cleared', 'success');
    measure();
  };
  return (
    <>
      <Group title="Media downloads">
        <Toggle label="Load photos automatically" sub="Turn off to save data. Photos load when you tap them." on={prefs.media_autoload} onChange={(v) => updatePrefs({ media_autoload: v })} />
      </Group>
      <Group title="Cache management">
        <div className="about-row"><Icon name="download" size={18} /><span>Browser cache</span><b>{local === null ? '-' : fmtBytes(local)}</b></div>
        <Row icon="trash" label="Clear cache" sub="Removes temporary data on this device. You stay signed in." onClick={() => setConfirm(true)} right={<span />} />
      </Group>
      <Group title="Storage usage">
        {!s ? <Spinner /> : (
          <>
            <div className="storage-total"><b>{fmtBytes(total)}</b> of media you’ve uploaded</div>
            {[['posts', 'Posts'], ['stories', 'Mood Stories'], ['chats', 'Chats'], ['comments', 'Comments'], ['profile', 'Profile photo']].map(([k, l]) => (
              <div key={k} className="storage-row">
                <span>{l}</span><div className="bar"><i style={{ width: `${total ? (s[k] / total) * 100 : 0}%` }} /></div><b>{fmtBytes(s[k])}</b>
              </div>
            ))}
          </>
        )}
      </Group>
      {confirm && <Confirm title="Clear cache?" confirmLabel="Clear" onClose={() => setConfirm(false)} onConfirm={clearCache} message="Temporary data on this device will be removed. Your posts and messages aren’t affected." />}
    </>
  );
}

const FAQ = [
  ['What is a Mood Story?', 'A photo, text or mood you share with friends for 24 hours. Save the ones you love to Highlights from your story archive.'],
  ['Who can see my posts?', 'Public accounts show posts to everyone on Hunch. Friends-only accounts show them only to accepted friends. Change it in Settings → Privacy.'],
  ['How do chat streaks work?', 'When you and a friend both send messages on consecutive days, a 🔥 streak appears. Miss a day and it resets.'],
  ['How do I log my mood?', 'Use “How are you feeling today?” on your timeline, or set a mood on a Note or Mood Story. Your team’s anonymous totals power the mood reports.'],
  ['I forgot my password.', 'Tap “Forgot Password?” on the sign-in screen. An administrator will issue you a temporary password.'],
  ['How do I report someone?', 'Open their profile or chat details, tap Options → Report. Reports go privately to your administrators.'],
];
function Help() {
  const { toast } = useApp();
  const [open, setOpen] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [f, setF] = useState({ subject: '', message: '' });
  const send = async () => {
    try { await api('/support', { method: 'POST', body: f }); toast('Message sent to support', 'success'); setSheet(null); setF({ subject: '', message: '' }); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <Group title="Frequently asked questions">
        {FAQ.map(([q, a], i) => (
          <div key={q} className={`faq ${open === i ? 'open' : ''}`}>
            <button onClick={() => setOpen(open === i ? null : i)}><span>{q}</span><Icon name="down" size={17} /></button>
            {open === i && <p>{a}</p>}
          </div>
        ))}
      </Group>
      <Group>
        <Row icon="mail" label="Contact support" sub="Message your Hunch administrators" onClick={() => setSheet('contact')} />
        <Row icon="file" label="Terms & Conditions" onClick={() => setSheet('terms')} />
        <Row icon="shield" label="Privacy Policy" onClick={() => setSheet('privacy')} />
      </Group>
      {sheet === 'contact' && (
        <Sheet title="Contact support" onClose={() => setSheet(null)} footer={<button className="btn block" disabled={!f.subject.trim() || !f.message.trim()} onClick={send}>Send</button>}>
          <label className="label">Subject</label><input className="input" value={f.subject} maxLength={150} onChange={(e) => setF({ ...f, subject: e.target.value })} />
          <label className="label">How can we help?</label><textarea className="input" rows={5} value={f.message} maxLength={2000} onChange={(e) => setF({ ...f, message: e.target.value })} />
        </Sheet>
      )}
      {sheet === 'terms' && (
        <Sheet title="Terms & Conditions" onClose={() => setSheet(null)}>
          <div className="legal">
            <p>Hunch is a workplace community app provided by your organisation. By using it you agree to:</p>
            <ul><li>Use your own account and keep your password private.</li><li>Be respectful: no harassment, hate speech or sharing of confidential work information.</li>
              <li>Share only content you have the right to share.</li><li>Accept that administrators may remove content or deactivate accounts that break these rules.</li></ul>
            <p>Your organisation may update these terms; continued use means you accept the latest version.</p>
          </div>
        </Sheet>
      )}
      {sheet === 'privacy' && (
        <Sheet title="Privacy Policy" onClose={() => setSheet(null)}>
          <div className="legal">
            <p><b>What we store:</b> your profile, posts, comments, stories, messages, mood check-ins and basic activity (logins and active days).</p>
            <p><b>Who sees it:</b> your content follows your privacy settings. Private messages are visible only to chat members.</p>
            <p><b>Mood data:</b> team leaders and managers see mood and attendance reports for their teams to support wellbeing. Your posts and messages are not part of those reports.</p>
            <p><b>Your choices:</b> change privacy, block people, turn off active status, or deactivate your account in Settings.</p>
          </div>
        </Sheet>
      )}
    </>
  );
}

const HELPS = [
  ['sparkle', 'Share your day', 'Post moments and Mood Stories from your day.'],
  ['smile', 'Express how you feel', 'Check in with a mood and see how your circle is doing.'],
  ['users', 'Stay close to friends', 'Connect with friends and discover mutual connections.'],
  ['map', 'Discover nearby moments', 'Find stories and activity happening around you on the map.'],
  ['briefcase', 'Work with your team', 'A private Work feed for your team’s posts and updates.'],
  ['calendar', 'Stay on schedule', 'Shifts, meetings, updates and announcements in one place.'],
  ['comment', 'Talk it through', 'Private and group messages with the people who matter.'],
  ['heart', 'Build real relationships', 'Grow both personal and professional connections.'],
];

function About() {
  const { settings } = useApp();
  return (
    <div className="about-hunch">
      <section className="ah-hero">
        <Logo size={64} />
        <h2>Hunch</h2>
        <p className="ah-tag">Connect. Express. Discover. Grow.</p>
      </section>

      <section className="ah-story">
        <h3>More than a social app</h3>
        <p>Hunch is a place to express yourself, connect with others, share your day and build meaningful relationships through moods, stories, conversations and communities.</p>
        <p>It was made to keep you close to your friends, show you the moments happening around you, help you work with your teammates, and let you share real life in a more personal, interactive way.</p>
        <p>Most platforms do one of these things. Hunch brings social networking, mood sharing, location-based discovery, team collaboration, workspaces, messaging and community into one seamless experience.</p>
      </section>

      <Group title="How Hunch helps you">
        <div className="ah-grid">
          {HELPS.map(([i, t, d]) => (
            <div key={t} className="ah-card"><span className="ah-ic"><Icon name={i} size={19} /></span><b>{t}</b><small>{d}</small></div>
          ))}
        </div>
      </Group>

      <blockquote className="ah-mission">
        <span>Our mission</span>
        “To create a platform where people can connect, express, discover, and grow together through shared experiences, meaningful conversations, and real-world connections.”
      </blockquote>

      <Group title="Version information">
        <div className="about-row"><Icon name="sparkle" size={18} /><span>Version</span><b>{settings.app_version || '-'}</b></div>
        <div className="about-row"><Icon name="globe" size={18} /><span>Platform</span><b>Web</b></div>
        <div className="about-row"><Icon name="settings" size={18} /><span>Build</span><b>{import.meta.env.MODE}</b></div>
      </Group>
      <p className="small muted" style={{ textAlign: 'center', margin: '18px 0 8px' }}>Made for people who share real moments.</p>
    </div>
  );
}
