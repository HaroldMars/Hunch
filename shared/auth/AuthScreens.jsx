// Hunch sign-in and first-login onboarding, shared by the client app and the admin dashboard.
// Each app passes its own `api` helper and session callbacks.
import { useEffect, useRef, useState } from 'react';
import Logo from '../Logo.jsx';
import Icon from '../Icon.jsx';
import './auth.css';

const QUOTES = [
  ['Your mood matters. Every feeling tells a story.', 'Hunch'],
  ['Small check-ins build strong teams.', 'Hunch'],
  ['It’s okay to not be okay. It’s better to say so.', 'Hunch'],
  ['Kindness is contagious. Start the spread.', 'Hunch'],
  ['Rest is productive too.', 'Hunch'],
  ['Great teams notice each other.', 'Hunch'],
  ['A good day starts with an honest feeling.', 'Hunch'],
  ['Celebrate the small wins; they add up.', 'Hunch'],
  ['Listening is the most underrated skill at work.', 'Hunch'],
  ['Progress, not perfection.', 'Hunch'],
  ['Your energy introduces you before you speak.', 'Hunch'],
  ['Take the break. The queue will still be there.', 'Hunch'],
  ['Connection turns colleagues into a team.', 'Hunch'],
  ['Feelings are information, not weakness.', 'Hunch'],
];
const quoteOfTheDay = () => {
  const d = new Date();
  const day = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  return QUOTES[day % QUOTES.length];
};

// Minimal line-art mood faces (Happy, Focused, Excited, Calm).
function MoodFace({ kind, size = 40 }) {
  const common = { fill: 'none', stroke: '#fff', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const faces = {
    happy: <><circle cx="15" cy="17" r="1.6" fill="#fff" stroke="none" /><circle cx="25" cy="17" r="1.6" fill="#fff" stroke="none" /><path d="M13 23.5c1.8 3 4.2 4.4 7 4.4s5.2-1.4 7-4.4" {...common} /></>,
    focused: <><path d="M12.5 16.5h5M22.5 16.5h5" {...common} /><path d="M12 13l5 1.5M28 13l-5 1.5" {...common} strokeWidth={1.6} /><path d="M16 26h8" {...common} /></>,
    excited: <><path d="M12.5 17.5l2.5-3 2.5 3M22.5 17.5l2.5-3 2.5 3" {...common} /><path d="M14 22.5h12c0 4-2.7 6.3-6 6.3s-6-2.3-6-6.3z" {...common} fill="rgba(255,255,255,.25)" /><path d="M32 6l.8 2.2L35 9l-2.2.8L32 12l-.8-2.2L29 9l2.2-.8z" fill="#fff" stroke="none" /></>,
    calm: <><path d="M12.5 17c1.2 1.4 3.8 1.4 5 0M22.5 17c1.2 1.4 3.8 1.4 5 0" {...common} /><path d="M15.5 25c1.4 1.2 2.9 1.8 4.5 1.8s3.1-.6 4.5-1.8" {...common} /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="17" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.55)" strokeWidth="1.5" />
      {faces[kind]}
    </svg>
  );
}

function CommunityMood({ api }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    const load = () => api('/auth/community-mood').then(setData).catch(() => {});
    load();
    const t = setInterval(load, 60e3);
    return () => clearInterval(t);
  }, [api]);
  return (
    <div className="hx-glass" aria-live="polite">
      <h4><span className="hx-live" /> {data?.period === 'week' ? 'This week’s community mood' : 'Today’s community mood'}</h4>
      {!data ? <div style={{ opacity: 0.7, fontSize: 13 }}>Loading…</div> : !data.top.length ? <div style={{ opacity: 0.8, fontSize: 13 }}>No check-ins yet today. Be the first!</div> : data.top.map((m) => (
        <div key={m.mood} className="hx-mood-row">
          <span>{m.emoji}</span><span>{m.label}</span><b>{m.pct}%</b>
          <div className="bar"><i style={{ width: `${m.pct}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export function AuthShell({ api, children }) {
  const [quote, by] = quoteOfTheDay();
  const floaters = [
    ['heart', '64%', '10%', 0], ['chat', '84%', '22%', -2], ['sparkle', '88%', '50%', -4], ['star', '56%', '46%', -6], ['users', '74%', '34%', -3], ['smile', '90%', '76%', -5],
  ];
  return (
    <div className="hx-auth">
      <section className="hx-brand" aria-label="About Hunch">
        <span className="hx-blob b1" /><span className="hx-blob b2" /><span className="hx-blob b3" />
        <div className="hx-floaters">
          {floaters.map(([n, left, top, delay]) => <span key={n} style={{ left, top, animationDelay: `${delay}s` }}><Icon name={n} size={18} /></span>)}
        </div>
        <div className="hx-brand-top"><Logo size={30} color="#fff" /> HUNCH</div>
        <div className="hx-hero">
          <h1>HUNCH</h1>
          <p className="tag">Connect. Share. Express.</p>
          <ul>
            <li><i><Icon name="chart" size={15} /></i> Track your moods.</li>
            <li><i><Icon name="users" size={15} /></i> Connect with friends.</li>
            <li><i><Icon name="heart" size={15} /></i> Build meaningful interactions.</li>
          </ul>
        </div>
        <div className="hx-moods" aria-hidden="true">
          {[['happy', 'Happy'], ['focused', 'Focused'], ['excited', 'Excited'], ['calm', 'Calm']].map(([k, l]) => (
            <div key={k} className="hx-mood-card"><MoodFace kind={k} />{l}</div>
          ))}
        </div>
        <div className="hx-extras">
          <CommunityMood api={api} />
          <div className="hx-glass"><h4><Icon name="sparkle" size={13} /> Quote of the day</h4><p className="hx-quote">“{quote}”<small>{by}</small></p></div>
        </div>
      </section>
      <main className="hx-side"><div className="hx-mobile-logo"><Logo size={50} color="#fff" /></div>{children}</main>
    </div>
  );
}

export function Field({ label, type = 'text', value, onChange, error, autoComplete, autoFocus, inputMode, maxLength, className, textarea, toggle }) {
  const [show, setShow] = useState(false);
  const id = useRef(`hx-${Math.random().toString(36).slice(2)}`).current;
  const Tag = textarea ? 'textarea' : 'input';
  return (
    <div className={`hx-field ${error ? 'invalid' : ''}`}>
      <Tag id={id} type={toggle ? (show ? 'text' : 'password') : type} value={value} placeholder=" " onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete} autoFocus={autoFocus} inputMode={inputMode} maxLength={maxLength} className={className}
        aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} />
      <label htmlFor={id}>{label}</label>
      {toggle && (
        <button type="button" className="eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
          <Icon name={show ? 'eyeOff' : 'eye'} size={19} />
        </button>
      )}
      <div className="hx-hint" id={`${id}-err`} role={error ? 'alert' : undefined}>{error || ''}</div>
    </div>
  );
}

function useShake() {
  const [shake, setShake] = useState(false);
  const trigger = () => { setShake(false); requestAnimationFrame(() => setShake(true)); setTimeout(() => setShake(false), 450); };
  return [shake, trigger];
}

const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

/**
 * Sign-in card. `appKind` is this app ('client' | 'admin'). Everyone stays in the app they
 * signed in to — every role has a Hunch app account. The only hand-over is an agent signing
 * in on the dashboard, which they have no access to, so they're sent to the Hunch app.
 */
export function LoginScreen({ api, appKind, otherAppUrl, onSession, settings = {} }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState({});
  const [alert, setAlert] = useState(null);
  const [busy, setBusy] = useState(false);
  const [redirecting, setRedirecting] = useState(null);
  const [shake, doShake] = useShake();
  const googleRef = useRef(null);

  const finish = (res, rem) => {
    if (res.app === appKind) return onSession(res, rem);
    setRedirecting(res.app === 'admin' ? 'Admin Dashboard' : 'Hunch app');
    setTimeout(() => { window.location.href = `${otherAppUrl}#handoff=${encodeURIComponent(res.token)}&r=${rem ? 1 : 0}`; }, 700);
  };

  // Real Google Identity Services button when the server has a client id configured.
  useEffect(() => {
    if (!settings.google_client_id || mode !== 'login') return;
    const init = () => {
      window.google.accounts.id.initialize({
        client_id: settings.google_client_id,
        callback: async ({ credential }) => {
          setBusy(true); setAlert(null);
          try { finish(await api('/auth/google', { method: 'POST', body: { credential, remember, app: appKind } }), remember); } catch (e) { setAlert({ type: 'error', text: e.message }); doShake(); } finally { setBusy(false); }
        },
      });
      if (googleRef.current) window.google.accounts.id.renderButton(googleRef.current, { theme: 'outline', size: 'large', width: 356, text: 'continue_with', shape: 'pill' });
    };
    if (window.google?.accounts) return init();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = init;
    document.head.appendChild(s);
  }, [settings.google_client_id, mode]);

  const validate = () => {
    const e = {};
    if (!email.trim()) e.email = 'Enter your email address.';
    else if (email.includes('@') && !/^\S+@\S+\.\S+$/.test(email.trim())) e.email = 'That email address doesn’t look right.';
    if (mode === 'login' && !password) e.password = 'Enter your password.';
    setErrors(e);
    if (Object.keys(e).length) doShake();
    return !Object.keys(e).length;
  };

  const submit = async (ev) => {
    ev.preventDefault();
    setAlert(null);
    if (!validate()) return;
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const r = await api('/auth/forgot', { method: 'POST', body: { identifier: email.trim() } });
        setAlert({ type: 'success', text: r.message });
      } else {
        finish(await api('/auth/login', { method: 'POST', body: { identifier: email.trim(), password, remember, app: appKind } }), remember);
      }
    } catch (e) {
      setAlert({ type: 'error', text: e.message });
      if (e.status === 401) setErrors({ password: ' ' });
      doShake();
    } finally { setBusy(false); }
  };

  if (redirecting) {
    return (
      <AuthShell api={api}>
        <div className="hx-card"><div className="hx-redirect"><div className="hx-spin" /><h2 style={{ fontSize: 22 }}>Welcome back!</h2><p className="sub" style={{ margin: '8px 0 0' }}>Taking you to the {redirecting}…</p></div></div>
      </AuthShell>
    );
  }

  return (
    <AuthShell api={api}>
      <form className={`hx-card ${shake ? 'shake' : ''}`} onSubmit={submit} noValidate>
        
        <h2>{mode === 'login' ? 'Welcome Back' : 'Reset password'}</h2>
        <p className="sub">{mode === 'login' ? 'Sign in to continue your journey.' : 'Enter your account email. An administrator will be notified to issue you a temporary password.'}</p>
        {settings.maintenance_banner && mode === 'login' && <div className="hx-alert info"><Icon name="megaphone" size={17} /> {settings.maintenance_banner}</div>}
        {alert && <div className={`hx-alert ${alert.type}`} role="alert"><Icon name={alert.type === 'error' ? 'close' : 'check'} size={17} /> {alert.text}</div>}
        <Field label="Email Address" type="email" value={email} onChange={(v) => { setEmail(v); setErrors({ ...errors, email: null }); }} error={errors.email} autoComplete="username" autoFocus />
        {mode === 'login' && (
          <>
            <Field label="Password" value={password} toggle onChange={(v) => { setPassword(v); setErrors({ ...errors, password: null }); }} error={errors.password?.trim()} autoComplete="current-password" />
            <div className="hx-row">
              <label className="hx-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember me</label>
            </div>
          </>
        )}
        <button className="hx-btn" disabled={busy}>
          {busy ? <><span className="hx-spin" /> {mode === 'login' ? 'Signing In...' : 'Sending...'}</> : mode === 'login' ? 'Sign In' : 'Send reset request'}
        </button>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button type="button" className="hx-link" onClick={() => { setMode(mode === 'login' ? 'forgot' : 'login'); setAlert(null); setErrors({}); }}>
            {mode === 'login' ? 'Forgot Password?' : 'Back to sign in'}
          </button>
        </div>
        {mode === 'login' && (
          <>
            <div className="hx-or">OR</div>
            {settings.google_client_id ? <div ref={googleRef} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} /> : (
              <button type="button" className="hx-btn ghost" onClick={() => setAlert({ type: 'info', text: 'Google sign-in isn’t enabled on this server yet. Ask your administrator, or sign in with your email and password.' })}>
                <GoogleG /> Continue with Google
              </button>
            )}
          </>
        )}
        <p className="hx-foot">
          Don’t have an account?<br />Contact your administrator.
          {settings.allow_account_requests && settings.requestAccountHref && <><br /><a href={settings.requestAccountHref} style={{ fontWeight: 700 }}>Request access</a></>}
        </p>
      </form>
    </AuthShell>
  );
}

const STEPS = [['verify', 'Verify email'], ['change-password', 'New password'], ['complete-profile', 'Your profile']];

function strength(p) {
  let s = 0;
  if (p.length >= 8) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p) || p.length >= 12) s++;
  return s;
}

/** First-login flow: verify email → create a new password → complete profile. */
export function Onboarding({ api, session, setSession, logout }) {
  const step = session.next;
  const idx = STEPS.findIndex(([k]) => k === step);
  const [shake, doShake] = useShake();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const user = session.user;

  const run = async (fn) => {
    setErr(''); setBusy(true);
    try { setSession(await fn()); } catch (e) { setErr(e.message); doShake(); } finally { setBusy(false); }
  };

  return (
    <AuthShell api={api}>
      <div className={`hx-card ${shake ? 'shake' : ''}`}>
        
        <div className="hx-steps" aria-label={`Step ${idx + 1} of 3`}>
          {STEPS.map(([k, l], i) => <div key={k} className={i < idx ? 'done' : i === idx ? 'on' : ''}><i><b /></i><span>{i + 1}. {l}</span></div>)}
        </div>
        {err && <div className="hx-alert error" role="alert"><Icon name="close" size={17} /> {err}</div>}
        {step === 'verify' && <VerifyStep api={api} user={user} busy={busy} run={run} />}
        {step === 'change-password' && <PasswordStep api={api} user={user} busy={busy} run={run} onInvalid={(m) => { setErr(m); doShake(); }} />}
        {step === 'complete-profile' && <ProfileStep api={api} user={user} busy={busy} run={run} />}
        <p className="hx-foot" style={{ marginTop: 18 }}>Signed in as {user.email} · <button type="button" className="hx-link" onClick={logout}>Sign out</button></p>
      </div>
    </AuthShell>
  );
}

function VerifyStep({ api, user, busy, run }) {
  const [code, setCode] = useState('');
  const [dev, setDev] = useState('');
  const [sent, setSent] = useState(false);
  const send = () => api('/auth/verify/send', { method: 'POST' }).then((r) => { setDev(r.devCode || ''); setSent(true); }).catch(() => {});
  useEffect(() => { send(); }, []);
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(() => api('/auth/verify', { method: 'POST', body: { code } })); }}>
      <h2>Verify your email</h2>
      <p className="sub">Welcome to Hunch, {user.full_name.split(' ')[0]}! {sent ? <>We sent a 6-digit code to <b>{user.email}</b>.</> : 'Sending your code…'}</p>
      <Field label="Verification code" value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} className="hx-code" autoFocus autoComplete="one-time-code" />
      {dev && <div className="hx-alert info"><Icon name="key" size={17} /> Local dev mode (no mail server): your code is <b style={{ letterSpacing: '.15em' }}>{dev}</b></div>}
      <button className="hx-btn" disabled={busy || code.length !== 6}>{busy ? <><span className="hx-spin" /> Verifying...</> : 'Verify & continue'}</button>
      <div style={{ textAlign: 'center', marginTop: 14 }}><button type="button" className="hx-link" onClick={send}>Resend code</button></div>
    </form>
  );
}

function PasswordStep({ api, busy, run, onInvalid }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const s = strength(pw);
  const colors = ['#e5484d', '#f59e0b', '#3b82f6', '#1f9d63'];
  const submit = (e) => {
    e.preventDefault();
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return onInvalid('Use at least 8 characters with letters and numbers.');
    if (pw !== confirm) return onInvalid('Passwords don’t match.');
    run(() => api('/auth/change-password', { method: 'POST', body: { newPassword: pw } }));
  };
  return (
    <form onSubmit={submit} noValidate>
      <h2>Welcome to Hunch</h2>
      <p className="sub">Your account is using a temporary password.<br />Please create a new password.</p>
      <Field label="New Password" value={pw} onChange={setPw} toggle autoComplete="new-password" autoFocus />
      <div className="hx-strength" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} style={{ background: i < s ? colors[s - 1] : undefined }} />)}</div>
      <div className="hx-hint ok">{pw ? ['Too weak', 'Weak', 'Good', 'Strong', 'Very strong'][s] : '8+ characters, with letters and numbers.'}</div>
      <Field label="Confirm Password" value={confirm} onChange={setConfirm} toggle autoComplete="new-password" error={confirm && confirm !== pw ? 'Passwords don’t match.' : null} />
      <button className="hx-btn" disabled={busy}>{busy ? <><span className="hx-spin" /> Saving...</> : 'Continue'}</button>
    </form>
  );
}

function ProfileStep({ api, user, busy, run }) {
  const [f, setF] = useState({ full_name: user.full_name || '', job_title: user.job_title || '', location: user.location || '', bio: user.bio || '' });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(user.avatar || '');
  const ref = useRef();
  useEffect(() => {
    if (!file) return undefined;
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const submit = (e) => {
    e.preventDefault();
    const form = new FormData();
    Object.entries(f).forEach(([k, v]) => form.append(k, v));
    if (file) form.append('avatar', file);
    run(() => api('/auth/complete-profile', { method: 'POST', form }));
  };
  const initials = (f.full_name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  return (
    <form onSubmit={submit}>
      <h2>Complete your profile</h2>
      <p className="sub">Help your teammates recognise you. You can change this anytime.</p>
      <div className="hx-avatar-pick">
        <div className="av">{preview ? <img src={preview} alt="" /> : initials}</div>
        <div>
          <button type="button" className="hx-btn ghost" style={{ height: 40, width: 'auto', padding: '0 16px', fontSize: 14 }} onClick={() => ref.current.click()}><Icon name="camera" size={17} /> {preview ? 'Change photo' : 'Add photo'}</button>
          <div className="hx-hint ok" style={{ paddingTop: 6 }}>Optional · JPG or PNG</div>
        </div>
        <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => setFile(e.target.files[0] || null)} />
      </div>
      <Field label="Full name" value={f.full_name} onChange={set('full_name')} autoComplete="name" error={!f.full_name.trim() ? 'Your name is required.' : null} />
      <div className="hx-grid2">
        <Field label="Job title" value={f.job_title} onChange={set('job_title')} maxLength={80} />
        <Field label="Location" value={f.location} onChange={set('location')} maxLength={80} />
      </div>
      <Field label="Short bio (optional)" value={f.bio} onChange={set('bio')} textarea maxLength={300} />
      <button className="hx-btn" disabled={busy || !f.full_name.trim()}>{busy ? <><span className="hx-spin" /> Saving...</> : 'Finish & enter Hunch'}</button>
    </form>
  );
}
