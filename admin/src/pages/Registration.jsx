import { useState } from 'react';
import Icon from '@shared/Icon.jsx';
import { ROLE_LABELS } from '@shared/constants.js';
import { api } from '../api.js';
import { PageHead, Spinner, Modal, CopySecret, useLoad } from '../ui.jsx';

// What each staff role can open in this dashboard (mirrors backend/src/auth.js MODULES).
const ROLE_INFO = {
  developer: 'Everything, including System Settings and Admin Management.',
  sysadmin: 'Everything: users, staff accounts, teams, reports and system settings.',
  employee: 'Statistics, reports, teams, notifications, email and user management.',
  support: 'User management (password resets, account status), reports, notifications and email.',
  operations: 'Statistics, reports, teams (platform monitoring), notifications and email.',
};
const blank = { full_name: '', email: '', username: '', role: '', job_title: '' };

/** Registration: create Hunch staff accounts. Everyone else creates their own account in the Hunch app. */
export default function Registration() {
  const opts = useLoad(() => api('/admin/accounts/options'), []);
  const [f, setF] = useState(blank);
  const [created, setCreated] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const roles = opts.data?.roles || [];
  const role = f.role || roles[0] || '';

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await api('/admin/accounts', { method: 'POST', body: { ...f, role } });
      setCreated(r);
      setF({ ...blank, role });
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHead title="Registration" sub="Create Hunch staff accounts. Each gets a temporary password that must be changed at first sign-in." />
      <div className="grid g2">
        <form className="card" onSubmit={submit}>
          <h3>Create staff account</h3>
          <p className="hint">Staff sign in to this dashboard with their email or username.</p>
          {opts.loading ? <Spinner /> : !roles.length ? <p className="muted">You can’t create staff accounts.</p> : (
            <>
              <label className="label">Role</label>
              <div className="tabs" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
                {roles.map((r) => <button type="button" key={r} className={role === r ? 'active' : ''} onClick={() => setF({ ...f, role: r })}>{ROLE_LABELS[r]}</button>)}
              </div>
              <p className="small muted" style={{ margin: '8px 0 0' }}>{ROLE_INFO[role]}</p>
              <label className="label">Full name</label><input className="input" value={f.full_name} onChange={set('full_name')} required />
              <label className="label">Work email</label><input className="input" type="email" value={f.email} onChange={set('email')} required />
              <div className="grid g2" style={{ gap: 12 }}>
                <div><label className="label">Username (optional)</label><input className="input" value={f.username} onChange={set('username')} placeholder="e.g. jdelacruz" /></div>
                <div><label className="label">Job title</label><input className="input" value={f.job_title} onChange={set('job_title')} placeholder={ROLE_LABELS[role]} /></div>
              </div>
              {err && <div className="error-text">{err}</div>}
              <div style={{ marginTop: 18 }}>
                <button className="btn" disabled={busy}><Icon name="userPlus" size={16} /> Create {ROLE_LABELS[role]} account</button>
              </div>
            </>
          )}
        </form>
        <div className="card">
          <h3>Who uses the Admin Dashboard</h3>
          <p className="hint">Only Hunch staff. Regular users can never open it: if they sign in here, they’re sent to the Hunch app.</p>
          {Object.entries(ROLE_INFO).map(([k, v]) => (
            <div key={k} className="notif-row"><div style={{ flex: 1 }}><div className="t">{ROLE_LABELS[k]}</div><div className="b small">{v}</div></div></div>
          ))}
          <div className="notif-row"><div style={{ flex: 1 }}><div className="t">Everyone else</div><div className="b small">People create their own account in the Hunch app with email and password or Continue with Google. No registration needed.</div></div></div>
        </div>
      </div>
      {created && (
        <Modal title="Account created" onClose={() => setCreated(null)} footer={<button className="btn" onClick={() => setCreated(null)}>Done</button>}>
          <p><b>{created.user.full_name}</b> ({ROLE_LABELS[created.user.role]}, {created.user.user_code}) can now sign in with <b>{created.user.email}</b>{created.user.username ? <> or username <b>{created.user.username}</b></> : ''}.</p>
          <p className="small muted">Temporary password. Share it securely. It is shown only once; they must verify their email and set a new password at first sign-in.</p>
          <CopySecret value={created.tempPassword} />
        </Modal>
      )}
    </>
  );
}
