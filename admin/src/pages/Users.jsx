import { useEffect, useState } from 'react';
import Icon from '@shared/Icon.jsx';
import { ROLE_LABELS, STAFF_ROLES, isStaffRole } from '@shared/constants.js';
import { api } from '../api.js';
import { useAdmin, PageHead, Spinner, Empty, Modal, Confirm, Avatar, Switch, CopySecret, ago, fmtDate, useLoad } from '../ui.jsx';

function EditUser({ u, assignable, onClose, onSaved }) {
  const { user, can, toast } = useAdmin();
  const [f, setF] = useState({ full_name: u.full_name, email: u.email, job_title: u.job_title, role: u.role, status: u.status });
  const [temp, setTemp] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  // Only developers and system administrators change staff roles.
  const roleOptions = can('admins') ? assignable : (isStaffRole(u.role) ? [] : ['user']);
  const self = u.id === user.id;
  const save = async () => {
    setErr('');
    try {
      const body = { full_name: f.full_name, email: f.email, job_title: f.job_title, status: f.status };
      if (f.role !== u.role) body.role = f.role;
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body });
      toast('User updated', 'success');
      onSaved(); onClose();
    } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title={`Manage ${u.full_name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" onClick={save}>Save changes</button></>}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
        <Avatar user={u} size={48} />
        <div><b>{u.user_code}</b> {u.username && <span className="muted">· @{u.username}</span>}<div className="small muted">Created {fmtDate(u.created_at)} · last login {ago(u.last_login_at)}</div></div>
      </div>
      <div className="grid g2" style={{ gap: 12 }}>
        <div><label className="label">Full name</label><input className="input" value={f.full_name} onChange={set('full_name')} /></div>
        <div><label className="label">Email</label><input className="input" value={f.email} onChange={set('email')} /></div>
        <div><label className="label">Job title</label><input className="input" value={f.job_title} onChange={set('job_title')} /></div>
        <div><label className="label">Role</label>
          <select className="select input" value={f.role} onChange={set('role')} disabled={self}>
            {[...new Set([u.role, ...roleOptions])].map((r) => <option key={r} value={r} disabled={!roleOptions.includes(r)}>{ROLE_LABELS[r]}</option>)}
          </select></div>
      </div>
      <div className="notif-row" style={{ alignItems: 'center', marginTop: 12 }}>
        <div style={{ flex: 1 }}><div className="t">Account active</div><div className="b small">Deactivated users can’t sign in to the app or dashboard.</div></div>
        <Switch on={f.status === 'active'} disabled={self} onChange={(on) => setF({ ...f, status: on ? 'active' : 'disabled' })} label="Account active" />
      </div>
      <div className="notif-row" style={{ alignItems: 'center' }}>
        <div style={{ flex: 1 }}><div className="t">Reset password</div><div className="b small">Issues a new temporary password. The user must change it at next sign-in.</div></div>
        <button className="btn ghost sm" onClick={() => setConfirmReset(true)}><Icon name="key" size={14} /> Reset</button>
      </div>
      {temp && <><p className="small muted">New temporary password (shown once):</p><CopySecret value={temp} /></>}
      {err && <div className="error-text">{err}</div>}
      {confirmReset && <Confirm title="Reset password?" message={`${u.full_name}'s current password will stop working immediately.`} confirmLabel="Reset password" onClose={() => setConfirmReset(false)}
        onConfirm={async () => { const r = await api(`/admin/users/${u.id}/reset-password`, { method: 'POST' }); setTemp(r.tempPassword); onSaved(); }} />}
    </Modal>
  );
}

function UserTable({ rows, onEdit, manageable }) {
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>User</th><th>Role</th><th>Signed up</th><th>Status</th><th>Onboarding</th><th>Last active</th><th /></tr></thead>
      <tbody>{rows.map((u) => (
        <tr key={u.id} className={manageable.includes(u.role) ? 'click' : ''} onClick={() => manageable.includes(u.role) && onEdit(u)}>
          <td><div className="user-cell"><Avatar user={u} /><div><b>{u.full_name}</b><span>{u.email} · {u.user_code}</span></div></div></td>
          <td><span className={`tag ${isStaffRole(u.role) ? 'blue' : ''}`}>{ROLE_LABELS[u.role]}</span></td>
          <td className="muted">{{ email: 'Email', google: 'Google', admin: 'Created by staff' }[u.signup_method] || '-'}</td>
          <td>{u.status === 'active' ? <span className="tag green">Active</span> : <span className="tag red">Deactivated</span>}{u.reset_pending ? <span className="tag amber" style={{ marginLeft: 4 }}>reset requested</span> : null}</td>
          <td>{u.must_change_password ? <span className="tag amber">Temp password</span> : u.verified ? <span className="tag green">Complete</span> : <span className="tag amber">Unverified</span>}</td>
          <td className="muted">{ago(u.last_active_at)}</td>
          <td>{manageable.includes(u.role) && <Icon name="next" size={16} />}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

export default function Users() {
  const [tab, setTab] = useState(new URLSearchParams(location.search).get('tab') || 'users');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null);
  const resets = useLoad(() => api('/admin/password-requests'), []);
  const load = () => api(`/admin/users?q=${encodeURIComponent(q)}&role=${role}&status=${status}`).then(setData);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [q, role, status]);
  const pendingResets = (resets.data || []).filter((r) => r.status === 'pending');
  return (
    <>
      <PageHead title="User Management" sub="Everyone on Hunch: account status, roles and password resets" />
      <div className="tabs">
        <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>All users</button>
        <button className={tab === 'resets' ? 'active' : ''} onClick={() => setTab('resets')}>Password resets{pendingResets.length ? ` (${pendingResets.length})` : ''}</button>
      </div>
      {tab === 'users' ? (
        <>
          <div className="filters">
            <label className="f"><span>Search</span><input className="input" placeholder="Name, email or user ID" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} /></label>
            <label className="f"><span>Role</span><select className="select" value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{['user', ...STAFF_ROLES].map((k) => <option key={k} value={k}>{ROLE_LABELS[k]}</option>)}</select></label>
            <label className="f"><span>Status</span><select className="select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any</option><option value="active">Active</option><option value="disabled">Deactivated</option></select></label>
          </div>
          <div className="card" style={{ padding: 0 }}>
            {!data ? <Spinner /> : !data.users.length ? <Empty icon="users" title="No users found" /> : <div style={{ padding: '0 18px' }}><UserTable rows={data.users} manageable={data.manageable} onEdit={setEdit} /></div>}
          </div>
        </>
      ) : (
        <div className="card">
          <p className="hint">Requests from “Forget password” on the sign-in screens. Open the user to issue a temporary password.</p>
          {resets.loading ? <Spinner /> : !resets.data.length ? <Empty icon="key" title="No reset requests" /> : resets.data.map((r) => (
            <div key={r.id} className="notif-row" style={{ alignItems: 'center' }}>
              <div style={{ flex: 1 }}><div className="t">{r.full_name} <span className={`tag ${r.status === 'pending' ? 'amber' : 'green'}`}>{r.status}</span></div><div className="b small">{r.email} · {ROLE_LABELS[r.role]} · {r.user_code}</div><div className="m">{fmtDate(r.created_at)}</div></div>
              {r.status === 'pending' && data?.manageable.includes(r.role) && (
                <button className="btn sm" onClick={() => setEdit(data.users.find((u) => u.id === r.user_id))}><Icon name="key" size={14} /> Reset password</button>
              )}
            </div>
          ))}
        </div>
      )}
      {edit && <EditUser u={edit} assignable={data.assignable || ['user']} onClose={() => setEdit(null)} onSaved={() => { load(); resets.reload(); }} />}
    </>
  );
}

export function Admins() {
  const { data, loading, reload } = useLoad(() => api('/admin/admins'), []);
  const [edit, setEdit] = useState(null);
  const M = { Statistics: [1, 1, 1, 0, 1], Reports: [1, 1, 1, 1, 1], Teams: [1, 1, 1, 0, 1], Notifications: [1, 1, 1, 1, 1], Email: [1, 1, 1, 1, 1],
    'User Management': [1, 1, 1, 1, 0], Registration: [1, 1, 0, 0, 0], 'Admin Management': [1, 1, 0, 0, 0], 'System Settings': [1, 1, 0, 0, 0] };
  return (
    <>
      <PageHead title="Admin Management" sub="Hunch staff with Admin Dashboard access" />
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Permission matrix</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>Module</th>{STAFF_ROLES.map((g) => <th key={g}>{ROLE_LABELS[g]}</th>)}</tr></thead>
          <tbody>{Object.entries(M).map(([m, v]) => <tr key={m}><td><b>{m}</b></td>{v.map((x, i) => <td key={i}>{x ? <span className="tag green">✓</span> : <span className="muted">-</span>}</td>)}</tr>)}</tbody>
        </table></div>
      </div>
      {loading ? <Spinner /> : STAFF_ROLES.map((g) => {
        const rows = data.filter((u) => u.role === g);
        return (
          <div key={g} className="card" style={{ marginBottom: 16 }}>
            <h3>{ROLE_LABELS[g]} ({rows.length})</h3>
            {rows.length ? <UserTable rows={rows} manageable={STAFF_ROLES} onEdit={setEdit} /> : <p className="muted small">None yet.</p>}
          </div>
        );
      })}
      {edit && <EditUser u={edit} assignable={[...STAFF_ROLES, 'user']} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  );
}
