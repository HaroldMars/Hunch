import { useState } from 'react';
import Logo from '@shared/Logo.jsx';
import { api } from '../api.js';
import { useAdmin } from '../ui.jsx';

export function Login() {
  const { login } = useAdmin();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [msg, setMsg] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      if (forgot) {
        const r = await api('/auth/forgot', { method: 'POST', body: { identifier: id } });
        setMsg(r.message);
      } else await login(id.trim(), pw);
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <Logo size={44} color="#fff" />
        <h2>{forgot ? 'Reset password' : 'Admin Dashboard'}</h2>
        <p>{forgot ? 'Another administrator will be notified to issue you a temporary password.' : 'Sign in with your username or email.'}</p>
        <input className="field" placeholder="Username or email" value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" required aria-label="Username or email" />
        {!forgot && <input className="field" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required aria-label="Password" />}
        {msg && <p style={{ color: '#cfcfcf' }}>{msg}</p>}
        {err && <div className="error-text" role="alert">{err}</div>}
        <button className="btn block" disabled={busy}>{busy ? 'Please wait…' : forgot ? 'Send request' : 'Sign in'}</button>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button type="button" className="link-btn" style={{ color: '#5f7cff' }} onClick={() => { setForgot(!forgot); setErr(''); setMsg(''); }}>{forgot ? 'Back to sign in' : 'Forgot password?'}</button>
        </div>
      </form>
    </div>
  );
}

export function ChangePassword({ forced, onDone }) {
  const { setSession, logout, toast, user } = useAdmin();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (f.next !== f.confirm) return setErr('Passwords do not match.');
    try {
      setSession(await api('/auth/change-password', { method: 'POST', body: { currentPassword: f.current, newPassword: f.next } }));
      toast('Password updated', 'success');
      setF({ current: '', next: '', confirm: '' });
      onDone?.();
    } catch (ex) { setErr(ex.message); }
  };
  const form = (
    <form onSubmit={submit} className={forced ? 'login-card' : undefined}>
      {forced && <><Logo size={40} color="#fff" /><h2>Set a new password</h2><p>Welcome, {user.full_name}. You must replace your temporary password before continuing.</p></>}
      <input className={forced ? 'field' : 'input'} type="password" placeholder={forced ? 'Current (temporary) password' : 'Current password'} value={f.current} onChange={set('current')} required autoComplete="current-password" style={forced ? undefined : { marginBottom: 10 }} />
      <input className={forced ? 'field' : 'input'} type="password" placeholder="New password (8+ chars, letters & numbers)" value={f.next} onChange={set('next')} required autoComplete="new-password" style={forced ? undefined : { marginBottom: 10 }} />
      <input className={forced ? 'field' : 'input'} type="password" placeholder="Confirm new password" value={f.confirm} onChange={set('confirm')} required autoComplete="new-password" />
      {err && <div className="error-text">{err}</div>}
      <button className="btn block" style={{ marginTop: 14 }}>Update password</button>
      {forced && <div style={{ textAlign: 'center', marginTop: 14 }}><button type="button" className="link-btn" style={{ color: '#9a9a9a' }} onClick={logout}>Sign out</button></div>}
    </form>
  );
  return forced ? <div className="login">{form}</div> : form;
}
