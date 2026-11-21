import { useState } from 'react';
import Icon from '@shared/Icon.jsx';
import { ROLE_LABELS } from '@shared/constants.js';
import { api } from '../api.js';
import { useAdmin, PageHead, Spinner, Empty, Modal, CopySecret, fmtDate, useLoad } from '../ui.jsx';

const blank = { full_name: '', email: '', username: '', role: 'agent', team_leader_id: '', job_title: '' };

export default function Registration() {
  const { user, toast } = useAdmin();
  const opts = useLoad(() => api('/admin/accounts/options'), []);
  const reqs = useLoad(() => api('/admin/account-requests'), []);
  const [f, setF] = useState(blank);
  const [requestId, setRequestId] = useState(null);
  const [created, setCreated] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const roles = opts.data?.roles || [];
  const needsTeam = ['agent', 'sme'].includes(f.role);
  const scoped = ['tl', 'sme'].includes(user.role);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await api('/admin/accounts', { method: 'POST', body: { ...f, request_id: requestId } });
      setCreated(r);
      setF({ ...blank, role: f.role, team_leader_id: f.team_leader_id });
      setRequestId(null);
      reqs.reload();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  const approve = (r) => {
    const tl = opts.data?.teamLeaders.find((t) => r.team_leader && t.full_name.toLowerCase().includes(r.team_leader.toLowerCase()));
    setF({ ...blank, full_name: r.full_name, email: r.email, role: roles.includes(r.requested_role) ? r.requested_role : roles[0], team_leader_id: tl?.id || '' });
    setRequestId(r.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const pending = (reqs.data || []).filter((r) => r.status === 'pending');
  return (
    <>
      <PageHead title="Registration" sub={scoped ? 'You have been granted permission to create agent accounts for your team.' : 'Create accounts. Each gets a temporary password that must be changed on first login.'} />
      <div className="grid g2">
        <form className="card" onSubmit={submit}>
          <h3>{requestId ? 'Approve account request' : 'Create account'}</h3>
          <p className="hint">Users sign in to the Hunch app with their email. Staff can also sign in to this dashboard with their username.</p>
          {opts.loading ? <Spinner /> : (
            <>
              <label className="label">Role</label>
              <div className="tabs" style={{ marginBottom: 0 }}>
                {roles.map((r) => <button type="button" key={r} className={f.role === r ? 'active' : ''} onClick={() => setF({ ...f, role: r })}>{ROLE_LABELS[r]}</button>)}
              </div>
              <label className="label">Full name</label><input className="input" value={f.full_name} onChange={set('full_name')} required />
              <label className="label">Email address</label><input className="input" type="email" value={f.email} onChange={set('email')} required />
              <div className="grid g2" style={{ gap: 12 }}>
                <div><label className="label">Username {f.role === 'agent' ? '(optional)' : '(for dashboard login)'}</label><input className="input" value={f.username} onChange={set('username')} placeholder="e.g. jdelacruz" /></div>
                <div><label className="label">Job title</label><input className="input" value={f.job_title} onChange={set('job_title')} placeholder={ROLE_LABELS[f.role]} /></div>
              </div>
              {needsTeam && (
                <>
                  <label className="label">Team leader</label>
                  <select className="select input" value={f.team_leader_id} onChange={set('team_leader_id')} disabled={scoped}>
                    {!scoped && <option value="">Unassigned</option>}
                    {opts.data.teamLeaders.map((t) => <option key={t.id} value={t.id}>{t.full_name} ({t.user_code})</option>)}
                  </select>
                </>
              )}
              {err && <div className="error-text">{err}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                <button className="btn" disabled={busy}><Icon name="userPlus" size={16} /> Create {ROLE_LABELS[f.role]} account</button>
                {requestId && <button type="button" className="btn ghost" onClick={() => { setRequestId(null); setF(blank); }}>Cancel</button>}
              </div>
            </>
          )}
        </form>
        <div className="card">
          <div className="card-head"><h3>Account requests</h3>{pending.length > 0 && <span className="tag blue">{pending.length} pending</span>}</div>
          <p className="hint">Requests submitted from the app’s sign-in screen.</p>
          {reqs.loading ? <Spinner /> : !reqs.data?.length ? <Empty icon="users" title="No requests">New requests will appear here.</Empty> : reqs.data.map((r) => (
            <div key={r.id} className="notif-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t">{r.full_name} <span className={`tag ${r.status === 'pending' ? 'amber' : r.status === 'approved' ? 'green' : 'red'}`}>{r.status}</span></div>
                <div className="b small">{r.email} · wants {ROLE_LABELS[r.requested_role]}{r.team_leader ? ` · TL: ${r.team_leader}` : ''}</div>
                {r.message && <div className="b small" style={{ fontStyle: 'italic' }}>“{r.message}”</div>}
                <div className="m">{fmtDate(r.created_at)}</div>
              </div>
              {r.status === 'pending' && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <button className="btn sm" onClick={() => approve(r)}>Approve</button>
                  <button className="btn ghost sm" onClick={async () => { await api(`/admin/account-requests/${r.id}/reject`, { method: 'POST' }); toast('Request rejected'); reqs.reload(); }}>Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {created && (
        <Modal title="Account created" onClose={() => setCreated(null)} footer={<button className="btn" onClick={() => setCreated(null)}>Done</button>}>
          <p><b>{created.user.full_name}</b> ({ROLE_LABELS[created.user.role]}, {created.user.user_code}) can now sign in with <b>{created.user.email}</b>{created.user.username ? <> or username <b>{created.user.username}</b></> : ''}.</p>
          <p className="small muted">Temporary password. Share it securely. It is shown only once; the user must verify their account and set a new password on first login.</p>
          <CopySecret value={created.tempPassword} />
        </Modal>
      )}
    </>
  );
}
