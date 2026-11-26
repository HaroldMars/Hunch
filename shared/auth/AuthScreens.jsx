// Hunch welcome, sign-in, sign-up and first-login onboarding, shared by the client app and the admin dashboard.
// Deep-blue gradient, glass cards, large type, rounded fields: one design language across every auth screen.
// Each app passes its own `api` helper and session callbacks.
import { useEffect, useRef, useState } from 'react';
import Logo from '../Logo.jsx';
import Icon from '../Icon.jsx';
import { INTERESTS, isStaffRole } from '../constants.js';
import './auth.css';
import friendsPhoto from './img/friends.jpg';
import face1 from './img/faces/face1.jpg';
import face2 from './img/faces/face2.jpg';
import face3 from './img/faces/face3.jpg';
import face4 from './img/faces/face4.jpg';
import face5 from './img/faces/face5.jpg';
import face6 from './img/faces/face6.jpg';
import face7 from './img/faces/face7.jpg';
import face8 from './img/faces/face8.jpg';

// Google sign-in is turned off for now (the OAuth client's authorized origins still need setting up).
// Set to true to bring back the Google button and one-tap.
const GOOGLE_SIGN_IN = false;

// Decorative photos for the sign-in screens only (never used as anyone's profile picture):
// friends at sunset in the arch, and people with the mood they're sharing around it.
const FACES = [[face1, '😊'], [face2, '😎'], [face3, '🤩'], [face4, '🧐'], [face5, '⚡'], [face6, '😴']];
const PEOPLE = [face7, face8, face3, face2];

/** Friends photo in an arch frame, with people and their moods floating around it. */
function PhotoHero({ size = 'lg' }) {
  return (
    <div className={`hx-photo ${size}`} aria-hidden="true">
      <span className="glow" />
      <div className="frame">
        <img src={friendsPhoto} alt="" draggable={false} />
        <span className="shade" />
      </div>
      {FACES.map(([src, mood], i) => (
        <span key={src} className={`face f${i}`}><img src={src} alt="" draggable={false} /><b>{mood}</b></span>
      ))}
    </div>
  );
}

/** Top of the card on phones: an arch window with the friends photo. */
function Arch() {
  return (
    <div className="hx-arch" aria-hidden="true">
      <img className="hx-arch-photo" src={friendsPhoto} alt="" draggable={false} />
      <span className="hx-arch-shade" />
      {FACES.slice(0, 3).map(([src, mood], i) => (
        <span key={src} className={`face a${i}`}><img src={src} alt="" draggable={false} /><b>{mood}</b></span>
      ))}
      <span className="hx-arch-badge"><Logo size={18} color="#fff" /></span>
    </div>
  );
}
const Spark = () => <div className="hx-spark" aria-hidden="true"><i /><b>✦</b><i /></div>;

function Brand({ small }) {
  return <div className={`hx-logo ${small ? 'sm' : ''}`}><Logo size={small ? 22 : 26} color="#fff" /> Hunch</div>;
}

/** Background and layout for every auth screen. On wide screens a hero sits beside the card. */
export function AuthShell({ children, hero = true }) {
  return (
    <div className="hx-auth">
      <span className="hx-glow g1" /><span className="hx-glow g2" /><span className="hx-glow g3" />
      <span className="hx-stars" />
      <div className={`hx-layout ${hero ? 'with-hero' : ''}`}>
        {hero && (
          <section className="hx-hero" aria-label="About Hunch">
            <Brand />
            <PhotoHero />
            <div className="hx-hero-text">
              <p className="kicker">Connect · Express · Belong</p>
              <h1>Share <em>moments</em>,<br />feel together.</h1>
              <p className="lede">Share moments. Track moods. Build meaningful connections.</p>
            </div>
          </section>
        )}
        <main className="hx-side">{children}</main>
      </div>
    </div>
  );
}

/** First screen of the Hunch app for people who aren't signed in. */
export function WelcomeScreen({ onStart, onSignIn }) {
  return (
    <div className="hx-auth">
      <span className="hx-glow g1" /><span className="hx-glow g2" /><span className="hx-glow g3" />
      <span className="hx-stars" />
      <div className="hx-welcome">
        <Brand />
        <PhotoHero />
        <div className="hx-welcome-text">
          <p className="kicker">Connect · Express · Belong</p>
          <h1>Share <em>moments</em>.<br />Feel together.</h1>
          <p className="lede">Share moments. Track moods. Build meaningful connections.</p>
          <div className="hx-people">
            <span className="faces">{PEOPLE.map((src) => <i key={src}><img src={src} alt="" /></i>)}</span>
            <span>Friends sharing how they feel, every day</span>
          </div>
        </div>
        <div className="hx-welcome-actions">
          <button className="hx-btn" onClick={onStart}>Get Started <Icon name="next" size={18} /></button>
          <p className="hx-foot" style={{ margin: '14px 0 0' }}>Already have an account? <button type="button" className="hx-link" onClick={onSignIn}>Sign In</button></p>
        </div>
      </div>
    </div>
  );
}

export function Field({ label, type = 'text', value, onChange, error, autoComplete, autoFocus, inputMode, maxLength, className, textarea, toggle, icon }) {
  const [show, setShow] = useState(false);
  const id = useRef(`hx-${Math.random().toString(36).slice(2)}`).current;
  const Tag = textarea ? 'textarea' : 'input';
  return (
    <div className={`hx-field ${error ? 'invalid' : ''} ${icon ? 'has-icon' : ''}`}>
      <Tag id={id} type={toggle ? (show ? 'text' : 'password') : type} value={value} placeholder=" " onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete} autoFocus={autoFocus} inputMode={inputMode} maxLength={maxLength} className={className}
        aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} />
      <label htmlFor={id}>{label}</label>
      {icon && <span className="fi"><Icon name={icon} size={18} /></span>}
      {toggle && (
        <button type="button" className="eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
          <Icon name={show ? 'eyeOff' : 'eye'} size={19} />
        </button>
      )}
      <div className="hx-hint" id={`${id}-err`} role={error ? 'alert' : undefined}>{error || ''}</div>
    </div>
  );
}

/** Six one-digit boxes for an emailed code: auto-advance, backspace, paste, and the phone's code autofill. */
export function OtpInput({ value, onChange, onComplete, disabled, invalid }) {
  const refs = useRef([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] || '');
  const set = (next) => {
    const v = next.replace(/\D/g, '').slice(0, 6);
    onChange(v);
    if (v.length === 6) onComplete?.(v);
    return v;
  };
  const onKey = (i) => (e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) { e.preventDefault(); set(value.slice(0, i - 1)); refs.current[i - 1]?.focus(); }
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
  };
  const onInput = (i) => (e) => {
    const typed = e.target.value.replace(/\D/g, '');
    if (!typed) { set(value.slice(0, i) + value.slice(i + 1)); return; }
    // A paste or autofill can bring several digits at once.
    const v = set((value.slice(0, i) + typed).slice(0, 6));
    refs.current[Math.min(v.length, 5)]?.focus();
  };
  return (
    <div className={`hx-otp ${invalid ? 'invalid' : ''}`} role="group" aria-label="6-digit code">
      {digits.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} value={d} onChange={onInput(i)} onKeyDown={onKey(i)} onFocus={(e) => e.target.select()}
          inputMode="numeric" pattern="[0-9]*" maxLength={i === 0 ? 6 : 1} autoComplete={i === 0 ? 'one-time-code' : 'off'} autoFocus={i === 0}
          disabled={disabled} aria-label={`Digit ${i + 1}`} className={d ? 'filled' : ''} />
      ))}
    </div>
  );
}

/** Seconds left before another code can be sent. */
function useCountdown(seconds) {
  const [left, setLeft] = useState(seconds || 0);
  useEffect(() => { setLeft(seconds || 0); }, [seconds]);
  useEffect(() => {
    if (left <= 0) return undefined;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft];
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
 * Sign-in / sign-up card. `appKind` is this app ('client' | 'admin'). Everyone stays in the app they signed in to.
 * The Admin Dashboard is staff-only: anyone else signing in there is sent to the Hunch app.
 * `allowSignup` (Hunch app) adds Create Account: name, email and password, or Continue with Google.
 * `onBack` (Hunch app) returns to the Welcome screen.
 */
export function LoginScreen({ api, appKind, otherAppUrl, onSession, settings: settingsIn, allowSignup = false, initialMode = 'login', onModeChange, onBack }) {
  const settings = settingsIn || {}; // never crash if the server couldn't be reached
  const [mode, setMode] = useState(allowSignup ? initialMode : 'login');
  // Hunch app: first choose how to continue (Email or Google); the email form opens on request.
  const [step, setStep] = useState(allowSignup ? 'choose' : 'email');
  // Sign-up code step: { email, emailed, devCode, resendIn }.
  const [otp, setOtp] = useState(null);
  const [code, setCode] = useState('');
  const [resendLeft, setResendLeft] = useCountdown(otp?.resendIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState({});
  const [alert, setAlert] = useState(null);
  const [busy, setBusy] = useState(false);
  const [redirecting, setRedirecting] = useState(null);
  const [shake, doShake] = useShake();
  const googleRef = useRef(null);
  const google = GOOGLE_SIGN_IN && mode !== 'forgot' && (allowSignup || mode === 'login') && (!allowSignup || step === 'choose');

  const finish = (res, rem) => {
    if (res.app === appKind) return onSession(res, rem);
    setRedirecting(res.app === 'admin' ? 'Admin Dashboard' : 'Hunch app');
    setTimeout(() => { window.location.href = `${otherAppUrl}#handoff=${encodeURIComponent(res.token)}&r=${rem ? 1 : 0}`; }, 700);
  };

  // Google Identity Services button (photo, name and email come from Google) when the server has a client id.
  useEffect(() => {
    if (!settings.google_client_id || !google) return;
    const init = () => {
      window.google.accounts.id.initialize({
        client_id: settings.google_client_id,
        callback: async ({ credential }) => {
          setBusy(true); setAlert(null);
          try { finish(await api('/auth/google', { method: 'POST', body: { credential, remember, app: appKind } }), remember); } catch (e) { setAlert({ type: 'error', text: e.message }); doShake(); } finally { setBusy(false); }
        },
        // One-tap: returning Google users see their account and sign in with a single tap.
        auto_select: allowSignup,
        cancel_on_tap_outside: false,
        itp_support: true,
        use_fedcm_for_prompt: true,
        context: mode === 'signup' ? 'signup' : 'signin',
        ux_mode: 'popup',
      });
      if (allowSignup) { try { window.google.accounts.id.prompt(); } catch { /* one-tap unavailable */ } }
      if (googleRef.current) {
        const width = Math.min(400, Math.max(220, googleRef.current.offsetWidth || 340));
        googleRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(googleRef.current, { theme: 'filled_black', size: 'large', width, text: mode === 'signup' ? 'signup_with' : 'continue_with', shape: 'pill', logo_alignment: 'center' });
      }
    };
    if (window.google?.accounts) return init();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = init;
    document.head.appendChild(s);
  }, [settings.google_client_id, mode, step]);

  const validate = () => {
    const e = {};
    if (!email.trim()) e.email = 'Enter your email address.';
    else if (email.includes('@') && !/^\S+@\S+\.\S+$/.test(email.trim())) e.email = 'That email address doesn’t look right.';
    if (mode === 'login' && !password) e.password = 'Enter your password.';
    if (mode === 'signup') {
      if (!fullName.trim()) e.fullName = 'Enter your full name.';
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) e.email = 'Enter a valid email address.';
      if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) e.password = 'Use 8+ characters with letters and numbers.';
    }
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
      } else if (mode === 'signup') {
        // Nothing is created yet: we email a code first.
        const r = await api('/auth/signup/start', { method: 'POST', body: { full_name: fullName.trim(), email: email.trim(), password } });
        setCode(''); setOtp({ email: r.sentTo, emailed: r.emailed, devCode: r.devCode, resendIn: r.resendIn });
      } else {
        finish(await api('/auth/login', { method: 'POST', body: { identifier: email.trim(), password, remember, app: appKind } }), remember);
      }
    } catch (e) {
      setAlert({ type: 'error', text: e.message });
      if (e.status === 401) setErrors({ password: ' ' });
      doShake();
    } finally { setBusy(false); }
  };

  const switchMode = (m) => { setMode(m); setAlert(null); setErrors({}); if (m === 'forgot') setStep('email'); onModeChange?.(m); };

  if (redirecting) {
    return (
      <AuthShell>
        <div className="hx-card"><div className="hx-redirect"><div className="hx-spin" /><h2>Welcome back!</h2><p className="sub" style={{ margin: '8px 0 0' }}>Taking you to the {redirecting}…</p></div></div>
      </AuthShell>
    );
  }

  const verifyCode = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy(true); setAlert(null);
    try { finish(await api('/auth/signup/verify', { method: 'POST', body: { email: otp.email, code: value, remember } }), remember); } catch (e) { setAlert({ type: 'error', text: e.message }); setCode(''); doShake(); } finally { setBusy(false); }
  };
  const resend = async () => {
    setAlert(null);
    try {
      const r = await api('/auth/signup/resend', { method: 'POST', body: { email: otp.email } });
      setOtp((o) => ({ ...o, devCode: r.devCode, emailed: r.emailed, resendIn: r.resendIn + Math.random() / 1000 }));
      setResendLeft(r.resendIn); setCode('');
      setAlert({ type: 'success', text: 'A new code is on its way.' });
    } catch (e) { setAlert({ type: 'error', text: e.message }); }
  };

  // Sign-up step 2: enter the code we emailed. The account is created when it matches.
  if (otp) {
    return (
      <AuthShell>
        <form className={`hx-card ${shake ? 'shake' : ''}`} onSubmit={(e) => { e.preventDefault(); verifyCode(); }}>
          <div className="hx-card-top">
            <button type="button" className="hx-back" onClick={() => { setOtp(null); setAlert(null); }} aria-label="Back"><Icon name="back" size={20} /></button>
            <Brand small /><span />
          </div>
          <div className="hx-otp-icon"><Icon name="mail" size={26} /></div>
          <h2>Check your email</h2>
          <p className="sub">Enter the 6-digit code we sent to<br /><b className="hx-strong">{otp.email}</b></p>
          {alert && <div className={`hx-alert ${alert.type}`} role="alert"><Icon name={alert.type === 'error' ? 'close' : 'check'} size={17} /> {alert.text}</div>}
          <OtpInput value={code} onChange={setCode} onComplete={verifyCode} disabled={busy} invalid={alert?.type === 'error'} />
          {otp.devCode && <div className="hx-alert info"><Icon name="key" size={17} /> Testing mode (no email server): your code is <b style={{ letterSpacing: '.15em' }}>{otp.devCode}</b></div>}
          <button className="hx-btn" disabled={busy || code.length !== 6} style={{ marginTop: 6 }}>{busy ? <><span className="hx-spin" /> Creating your account...</> : 'Verify & create account'}</button>
          <p className="hx-foot">
            Didn’t get it? Check spam, or {resendLeft > 0 ? <span className="hx-wait">resend in {resendLeft}s</span> : <button type="button" className="hx-link" onClick={resend}>Resend code</button>}
            <br /><button type="button" className="hx-link" onClick={() => { setOtp(null); setAlert(null); }}>Use a different email</button>
          </p>
        </form>
      </AuthShell>
    );
  }

  const choosing = allowSignup && step === 'choose' && mode !== 'forgot';
  const footer = (
    <p className="hx-foot">
      {mode === 'forgot' ? <button type="button" className="hx-link" onClick={() => { switchMode('login'); }}>Back to Sign In</button>
        : !allowSignup ? <>Hunch staff only. Staff accounts are created by a system administrator.</>
          : mode === 'signup' ? <>Already have an account? <button type="button" className="hx-link" onClick={() => switchMode('login')}>Sign In</button></>
            : <>Don’t have an account? <button type="button" className="hx-link" onClick={() => switchMode('signup')}>Sign Up</button></>}
    </p>
  );

  // Step 1 (Hunch app): the arch hero and a choice of Email or Google.
  if (choosing) {
    return (
      <AuthShell>
        <div className={`hx-card choose ${shake ? 'shake' : ''}`}>
          {onBack && <button type="button" className="hx-back floating" onClick={onBack} aria-label="Back"><Icon name="back" size={20} /></button>}
          <Arch />
          <Spark />
          <h2 className="hx-big">{mode === 'login' ? <>Welcome Back!<br /><span>Let’s Reconnect and Share</span></> : <>Join Hunch<br /><span>Share Moments, Feel Together</span></>}</h2>
          {alert && <div className={`hx-alert ${alert.type}`} role="alert"><Icon name={alert.type === 'error' ? 'close' : 'check'} size={17} /> {alert.text}</div>}
          {settings.maintenance_banner && mode === 'login' && <div className="hx-alert info"><Icon name="megaphone" size={17} /> {settings.maintenance_banner}</div>}
          <div className="hx-choices">
            <button type="button" className="hx-choice" onClick={() => { setStep('email'); setAlert(null); }}><Icon name="mail" size={18} /> {mode === 'login' ? 'Continue with Email' : 'Sign up with Email'}</button>
            {GOOGLE_SIGN_IN && (settings.google_client_id ? <div ref={googleRef} className="hx-google" /> : (
              <button type="button" className="hx-choice" onClick={() => setAlert({ type: 'info', text: 'Google sign-in isn’t enabled on this server yet. Use your email for now.' })}><GoogleG /> Continue with Google</button>
            ))}
          </div>
          {footer}
        </div>
      </AuthShell>
    );
  }

  const title = mode === 'login' ? 'Welcome Back' : mode === 'signup' ? 'Create Account' : 'Reset password';
  const sub = mode === 'login' ? (allowSignup ? 'Sign in with your email' : 'Sign in to the Admin Dashboard') : mode === 'signup' ? 'Join Hunch to share moments and moods with friends.' : 'Enter your account email. An administrator will be notified to issue you a temporary password.';
  return (
    <AuthShell>
      <form className={`hx-card ${shake ? 'shake' : ''}`} onSubmit={submit} noValidate>
        <div className="hx-card-top">
          {allowSignup ? <button type="button" className="hx-back" onClick={() => { setStep('choose'); if (mode === 'forgot') switchMode('login'); setAlert(null); setErrors({}); }} aria-label="Back"><Icon name="back" size={20} /></button>
            : onBack ? <button type="button" className="hx-back" onClick={onBack} aria-label="Back"><Icon name="back" size={20} /></button> : <span />}
          <Brand small />
          <span />
        </div>
        <h2>{title}</h2>
        <p className="sub">{sub}</p>
        {settings.maintenance_banner && mode === 'login' && <div className="hx-alert info"><Icon name="megaphone" size={17} /> {settings.maintenance_banner}</div>}
        {alert && <div className={`hx-alert ${alert.type}`} role="alert"><Icon name={alert.type === 'error' ? 'close' : 'check'} size={17} /> {alert.text}</div>}
        {google && (
          <>
            {settings.google_client_id ? <div ref={googleRef} className="hx-google" /> : (
              <button type="button" className="hx-btn glass" onClick={() => setAlert({ type: 'info', text: 'Google sign-in isn’t enabled on this server yet. Use your email and password for now.' })}>
                <GoogleG /> Continue with Google
              </button>
            )}
            <div className="hx-or">OR</div>
          </>
        )}
        {mode === 'signup' && <Field label="Full Name" icon="user" value={fullName} onChange={(v) => { setFullName(v); setErrors({ ...errors, fullName: null }); }} error={errors.fullName} autoComplete="name" maxLength={80} />}
        <Field label="Email Address" icon="mail" type="email" value={email} onChange={(v) => { setEmail(v); setErrors({ ...errors, email: null }); }} error={errors.email} autoComplete={mode === 'signup' ? 'email' : 'username'} />
        {mode !== 'forgot' && (
          <Field label="Password" icon="lock" value={password} toggle onChange={(v) => { setPassword(v); setErrors({ ...errors, password: null }); }}
            error={mode === 'login' ? errors.password?.trim() : errors.password} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
        )}
        {mode === 'login' && (
          <div className="hx-row">
            <label className="hx-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember me</label>
            <button type="button" className="hx-link" onClick={() => switchMode('forgot')}>Forgot Password?</button>
          </div>
        )}
        {mode === 'signup' && <div className="hx-hint ok" style={{ marginTop: -4, marginBottom: 10 }}>8+ characters with letters and numbers. We’ll email you a code to confirm it’s you.</div>}
        <button className="hx-btn" disabled={busy}>
          {busy ? <><span className="hx-spin" /> {mode === 'login' ? 'Signing In...' : mode === 'signup' ? 'Sending your code...' : 'Sending...'}</> : mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Continue' : 'Send reset request'}
        </button>
        {footer}
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
  // Only the steps this account goes through (email sign-ups skip the temporary password; Google sign-ups only fill in their profile).
  const steps = STEPS.filter(([k]) => !session.steps || session.steps.includes(k));
  const idx = steps.findIndex(([k]) => k === step);
  const [shake, doShake] = useShake();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const user = session.user;

  const run = async (fn) => {
    setErr(''); setBusy(true);
    try { setSession(await fn()); } catch (e) { setErr(e.message); doShake(); } finally { setBusy(false); }
  };

  return (
    <AuthShell>
      <div className={`hx-card ${shake ? 'shake' : ''}`}>
        <div className="hx-card-top"><span /><Brand small /><span /></div>
        <div className="hx-steps" aria-label={`Step ${idx + 1} of ${steps.length}`}>
          {steps.map(([k, l], i) => <div key={k} className={i < idx ? 'done' : i === idx ? 'on' : ''}><i><b /></i><span>{i + 1}. {l}</span></div>)}
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
  const [wait, setWait] = useState(0);
  const [left] = useCountdown(wait);
  const send = () => api('/auth/verify/send', { method: 'POST' }).then((r) => { setDev(r.devCode || ''); setSent(true); setWait((r.resendIn || 45) + Math.random() / 1000); }).catch(() => {});
  useEffect(() => { send(); }, []);
  const submit = (value = code) => value.length === 6 && !busy && run(() => api('/auth/verify', { method: 'POST', body: { code: value } }).catch((e) => { setCode(''); throw e; }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="hx-otp-icon"><Icon name="mail" size={26} /></div>
      <h2>Verify your email</h2>
      <p className="sub">Welcome to Hunch, {user.full_name.split(' ')[0]}! {sent ? <>Enter the 6-digit code we sent to <b className="hx-strong">{user.email}</b>.</> : 'Sending your code…'}</p>
      <OtpInput value={code} onChange={setCode} onComplete={submit} disabled={busy} />
      {dev && <div className="hx-alert info"><Icon name="key" size={17} /> Testing mode (no email server): your code is <b style={{ letterSpacing: '.15em' }}>{dev}</b></div>}
      <button className="hx-btn" disabled={busy || code.length !== 6} style={{ marginTop: 6 }}>{busy ? <><span className="hx-spin" /> Verifying...</> : 'Verify & continue'}</button>
      <p className="hx-foot">Didn’t get it? Check spam, or {left > 0 ? <span className="hx-wait">resend in {left}s</span> : <button type="button" className="hx-link" onClick={send}>Resend code</button>}</p>
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
  const [f, setF] = useState({ full_name: user.full_name || '', username: user.username || '', bio: user.bio || '' });
  const [interests, setInterests] = useState(Array.isArray(user.interests) ? user.interests : []);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(user.avatar || '');
  const [check, setCheck] = useState(null); // live username availability
  const [workMode, setWorkMode] = useState(!!user.work_mode);
  const member = !isStaffRole(user.role);
  const ref = useRef();
  useEffect(() => {
    if (!file) return undefined;
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  useEffect(() => {
    const name = f.username.trim();
    if (!name || name === user.username) return setCheck(null);
    const t = setTimeout(() => api(`/auth/username-available?u=${encodeURIComponent(name)}`).then(setCheck).catch(() => setCheck(null)), 350);
    return () => clearTimeout(t);
  }, [f.username]);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const toggle = (x) => setInterests((l) => (l.includes(x) ? l.filter((y) => y !== x) : l.length >= 10 ? l : [...l, x]));
  const submit = (e) => {
    e.preventDefault();
    const form = new FormData();
    Object.entries(f).forEach(([k, v]) => form.append(k, k === 'username' ? v.trim().replace(/^@/, '') : v));
    form.append('interests', JSON.stringify(interests));
    if (member) form.append('work_mode', workMode ? '1' : '0');
    if (file) form.append('avatar', file);
    run(() => api('/auth/complete-profile', { method: 'POST', form }));
  };
  const initials = (f.full_name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  const usernameError = check && !check.ok ? (check.reason === 'Taken' ? 'That username is taken.' : check.reason) : null;
  return (
    <form onSubmit={submit}>
      <h2>Set up your profile</h2>
      <p className="sub">Choose your username, photo and interests. You can change these anytime.</p>
      <div className="hx-avatar-pick">
        <div className="av">{preview ? <img src={preview} alt="" referrerPolicy="no-referrer" /> : initials}</div>
        <div>
          <button type="button" className="hx-btn ghost" style={{ height: 40, width: 'auto', padding: '0 16px', fontSize: 14 }} onClick={() => ref.current.click()}><Icon name="camera" size={17} /> {preview ? 'Change photo' : 'Add photo'}</button>
          <div className="hx-hint ok" style={{ paddingTop: 6 }}>Optional · JPG or PNG</div>
        </div>
        <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => setFile(e.target.files[0] || null)} />
      </div>
      <Field label="Full name" value={f.full_name} onChange={set('full_name')} autoComplete="name" error={!f.full_name.trim() ? 'Your name is required.' : null} />
      <Field label="Username" value={f.username} onChange={(v) => set('username')(v.replace(/\s/g, ''))} autoComplete="username" maxLength={31} error={usernameError} />
      <Field label="Bio (optional)" value={f.bio} onChange={set('bio')} textarea maxLength={300} />
      <div className="hx-interests" role="group" aria-label="Interests">
        <div className="hx-label">Interests <small>{interests.length ? `${interests.length} selected` : 'pick a few'}</small></div>
        <div className="hx-chips">
          {INTERESTS.map((x) => <button key={x} type="button" className={interests.includes(x) ? 'on' : ''} aria-pressed={interests.includes(x)} onClick={() => toggle(x)}>{x}</button>)}
        </div>
      </div>
      {member && (
        <label className="hx-toggle">
          <span className="ic"><Icon name="briefcase" size={18} /></span>
          <span className="tx"><b>Enable Work Mode <small>Optional</small></b><small>Create or join private teams with schedules, team chat and team moods. You can turn it on or off in Settings.</small></span>
          <input type="checkbox" checked={workMode} onChange={(e) => setWorkMode(e.target.checked)} />
          <i aria-hidden="true" />
        </label>
      )}
      <button className="hx-btn" disabled={busy || !f.full_name.trim() || !f.username.trim() || !!usernameError}>{busy ? <><span className="hx-spin" /> Saving...</> : 'Finish & enter Hunch'}</button>
    </form>
  );
}
