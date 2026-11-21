import { useEffect, useState } from 'react';
import Icon from '@shared/Icon.jsx';
import { ROLE_LABELS } from '@shared/constants.js';
import { api } from '../api.js';
import { useAdmin, PageHead, Spinner, Switch, Avatar, fmtDate } from '../ui.jsx';
import { ChangePassword } from './Login.jsx';

const FIELDS = [
  ['app_name', 'Application name', 'text', 'Shown on sign-in and in the app.'],
  ['story_hours', 'Mood Story visibility (hours)', 'number', 'How long a Mood Story stays visible. Default 24.'],
  ['note_hours', 'Note visibility (hours)', 'number', 'How long a chat note stays visible. Default 24.'],
  ['note_max_words', 'Note word limit', 'number', 'Maximum words in a note. Default 35.'],
  ['active_window_days', 'Active user window (days)', 'number', 'A user counts as active if seen within this many days.'],
  ['daily_report_hour', 'Daily report hour (0–23)', 'number', 'Server local time when daily reports are sent.'],
  ['maintenance_banner', 'App banner message', 'text', 'Optional banner shown at the top of the app timeline. Leave empty to hide.'],
];

export default function Settings() {
  const { toast } = useAdmin();
  const [data, setData] = useState(null);
  const [f, setF] = useState({});
  const load = () => api('/admin/settings').then((d) => { setData(d); setF(d.settings); });
  useEffect(() => { load(); }, []);
  const save = async () => {
    try { await api('/admin/settings', { method: 'PUT', body: f }); toast('Settings saved', 'success'); load(); } catch (e) { toast(e.message, 'error'); }
  };
  if (!data) return <Spinner />;
  return (
    <>
      <PageHead title="System Settings" sub="Developer-only configuration"><button className="btn" onClick={save}><Icon name="check" size={15} /> Save settings</button></PageHead>
      <div className="grid g3">
        <div className="card span2">
          {FIELDS.map(([k, label, type, hint]) => (
            <div key={k}>
              <label className="label">{label}</label>
              <input className="input" type={type} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
              <div className="small muted" style={{ marginTop: 4 }}>{hint}</div>
            </div>
          ))}
          <div className="notif-row" style={{ alignItems: 'center', marginTop: 12 }}>
            <div style={{ flex: 1 }}><div className="t">Allow account requests</div><div className="b small">Show “Request an account” on the app sign-in screen.</div></div>
            <Switch on={f.allow_account_requests === '1'} onChange={(on) => setF({ ...f, allow_account_requests: on ? '1' : '0' })} label="Allow account requests" />
          </div>
        </div>
        <div className="card">
          <h3>System status</h3>
          <p className="hint">Local build · SQLite database</p>
          {Object.entries(data.counts).map(([k, v]) => <div key={k} className="notif-row" style={{ padding: '8px 0' }}><div style={{ flex: 1, textTransform: 'capitalize' }}>{k.replace(/([A-Z])/g, ' $1')}</div><b>{v}</b></div>)}
          <div className="small muted" style={{ marginTop: 10 }}>Node {data.server.node} · up since {fmtDate(data.server.startedAt)}<br />Last daily report: {data.settings.last_daily_report || 'never'}</div>
        </div>
      </div>
    </>
  );
}

export function Account() {
  const { user, theme, setTheme } = useAdmin();
  return (
    <>
      <PageHead title="My account" />
      <div className="grid g2">
        <div className="card">
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <Avatar user={user} size={56} />
            <div><h3>{user.full_name}</h3><div className="muted small">{ROLE_LABELS[user.role]} · {user.user_code}{user.username ? ` · @${user.username}` : ''}</div><div className="muted small">{user.email}</div></div>
          </div>
          <label className="label" style={{ marginTop: 22 }}>Appearance</label>
          <div className="tabs">
            <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}><Icon name="moon" size={14} /> Dark</button>
            <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}><Icon name="sun" size={14} /> Light</button>
          </div>
          <p className="small muted">Profile photo and bio are edited in the Hunch app.</p>
        </div>
        <div className="card">
          <h3>Change password</h3>
          <p className="hint">Use 8+ characters with letters and numbers.</p>
          <ChangePassword />
        </div>
      </div>
    </>
  );
}
