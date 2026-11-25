import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../store.jsx';

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
