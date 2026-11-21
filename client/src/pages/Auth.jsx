import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell, Field } from '@shared/auth/AuthScreens.jsx';
import { api } from '../api.js';
import { useApp } from '../store.jsx';

/** "Request access" form linked from the sign-in card (admins approve it in Registration). */
export function RequestAccount() {
  const [f, setF] = useState({ full_name: '', email: '', requested_role: 'agent', team_leader: '', message: '' });
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await api('/auth/account-request', { method: 'POST', body: f });
      setDone(true);
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell api={api}>
      <form className="hx-card" onSubmit={submit}>
        {done ? (
          <>
            <h2>Request sent</h2>
            <p className="sub">An administrator will review your request. You'll receive your login details once your account is created.</p>
            <Link to="/login" className="hx-btn" style={{ textDecoration: 'none' }}>Back to sign in</Link>
          </>
        ) : (
          <>
            <h2>Request access</h2>
            <p className="sub">Hunch accounts are created by your administrator. Send a request and they'll set you up.</p>
            {err && <div className="hx-alert error" role="alert">{err}</div>}
            <Field label="Full name" value={f.full_name} onChange={set('full_name')} autoFocus />
            <Field label="Work email" type="email" value={f.email} onChange={set('email')} />
            <div className="hx-row" style={{ marginBottom: 14 }}>
              {[['agent', 'Agent'], ['sme', 'SME'], ['tl', 'Team Leader']].map(([k, l]) => (
                <label key={k} className="hx-check"><input type="checkbox" checked={f.requested_role === k} onChange={() => setF({ ...f, requested_role: k })} /> {l}</label>
              ))}
            </div>
            <Field label="Your team leader (optional)" value={f.team_leader} onChange={set('team_leader')} />
            <Field label="Message (optional)" value={f.message} onChange={set('message')} textarea maxLength={500} />
            <button className="hx-btn" disabled={busy}>{busy ? 'Sending...' : 'Submit request'}</button>
            <p className="hx-foot"><Link to="/login" style={{ fontWeight: 700 }}>Back to sign in</Link></p>
          </>
        )}
      </form>
    </AuthShell>
  );
}

/** In-app password change (Settings). First-login password creation lives in the shared onboarding. */
export function ChangePassword() {
  const { setSession, toast } = useApp();
  const nav = useNavigate();
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
      nav(-1);
    } catch (ex) { setErr(ex.message); }
  };
  return (
    <div className="page">
      <div className="topbar"><h2>Change password</h2></div>
      <form onSubmit={submit}>
        <label className="label">Current password</label>
        <input className="input" type="password" value={f.current} onChange={set('current')} required autoComplete="current-password" />
        <label className="label">New password</label>
        <input className="input" type="password" value={f.next} onChange={set('next')} required autoComplete="new-password" placeholder="8+ characters, letters & numbers" />
        <label className="label">Confirm new password</label>
        <input className="input" type="password" value={f.confirm} onChange={set('confirm')} required autoComplete="new-password" />
        {err && <div className="error-text">{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button type="button" className="btn ghost" style={{ flex: 1 }} onClick={() => nav(-1)}>Cancel</button>
          <button className="btn" style={{ flex: 1 }}>Save password</button>
        </div>
      </form>
    </div>
  );
}
