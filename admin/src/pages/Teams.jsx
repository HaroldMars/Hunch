import { useEffect, useState } from 'react';
import Icon from '@shared/Icon.jsx';
import { api } from '../api.js';
import { Avatar, Spinner, Empty, Confirm, PageHead, fmtDate } from '../ui.jsx';

/**
 * Teams: the private Work teams people create in the Hunch app.
 * Teams are private, so staff only see what moderation needs: name, owner, size and dates.
 * Never a team's feed, chats, schedules or members' activity.
 */
export default function Teams() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [confirm, setConfirm] = useState(null); // { team, action: 'archive' | 'restore' | 'delete' }
  const load = () => api(`/admin/teams?q=${encodeURIComponent(q)}&status=${status}`).then(setData);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [q, status]);
  const act = async () => {
    const { team, action } = confirm;
    if (action === 'delete') await api(`/admin/teams/${team.id}`, { method: 'DELETE' });
    else await api(`/admin/teams/${team.id}`, { method: 'PATCH', body: { status: action === 'archive' ? 'archived' : 'active' } });
    load();
  };
  const t = data?.totals;
  return (
    <>
      <PageHead title="Teams" sub="Private Work teams created in the Hunch app. Staff see team details for moderation, never team content." />
      {t && (
        <div className="grid g3" style={{ marginBottom: 16 }}>
          <div className="card stat"><div className="k"><Icon name="layers" size={15} /> Teams</div><div className="v">{t.teams || 0}</div><div className="d">{t.active || 0} active</div></div>
          <div className="card stat"><div className="k"><Icon name="users" size={15} /> People on teams</div><div className="v">{t.people || 0}</div></div>
          <div className="card stat"><div className="k"><Icon name="briefcase" size={15} /> Work Mode on</div><div className="v">{t.work_mode || 0}</div><div className="d">users</div></div>
        </div>
      )}
      <div className="filters">
        <label className="f"><span>Search</span><input className="input" placeholder="Team, owner name or email" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} /></label>
        <label className="f"><span>Status</span><select className="select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any</option><option value="active">Active</option><option value="archived">Suspended</option></select></label>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {!data ? <Spinner /> : !data.teams.length ? <Empty icon="layers" title="No teams yet">Teams appear here when people turn on Work Mode and create one.</Empty> : (
          <div className="table-wrap" style={{ padding: '0 18px' }}><table>
            <thead><tr><th>Team</th><th>Owner</th><th>Members</th><th>Created</th><th>Status</th><th /></tr></thead>
            <tbody>{data.teams.map((tm) => (
              <tr key={tm.id}>
                <td><div className="user-cell">{tm.logo ? <img src={tm.logo} alt="" className="team-logo-sm" /> : <span className="team-logo-sm ph">{tm.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>}<div><b>{tm.name}</b>{tm.description && <span>{tm.description.slice(0, 80)}</span>}</div></div></td>
                <td>{tm.owner ? <div className="user-cell"><Avatar user={tm.owner} /><div><b>{tm.owner.full_name}</b><span>{tm.owner.email}</span></div></div> : <span className="muted">-</span>}</td>
                <td>{tm.members}<div className="muted small">{tm.channels} channel{tm.channels === 1 ? '' : 's'}</div></td>
                <td className="muted">{fmtDate(tm.created_at)}</td>
                <td>{tm.status === 'active' ? <span className="tag green">Active</span> : <span className="tag red">Suspended</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {tm.status === 'active'
                    ? <button className="btn ghost sm" onClick={() => setConfirm({ team: tm, action: 'archive' })}>Suspend</button>
                    : <button className="btn ghost sm" onClick={() => setConfirm({ team: tm, action: 'restore' })}>Restore</button>}
                  {data.canDelete && <button className="btn ghost sm" style={{ color: 'var(--danger)', marginLeft: 6 }} onClick={() => setConfirm({ team: tm, action: 'delete' })} aria-label={`Delete ${tm.name}`}><Icon name="trash" size={14} /></button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {confirm && (
        <Confirm
          title={confirm.action === 'delete' ? `Delete ${confirm.team.name}?` : confirm.action === 'archive' ? `Suspend ${confirm.team.name}?` : `Restore ${confirm.team.name}?`}
          message={confirm.action === 'delete' ? 'The team, its feed, schedules and channels are deleted for every member. This can’t be undone.'
            : confirm.action === 'archive' ? 'Members lose access to the team until it is restored. They are notified.' : 'Members get access to the team again.'}
          confirmLabel={confirm.action === 'delete' ? 'Delete team' : confirm.action === 'archive' ? 'Suspend' : 'Restore'}
          danger={confirm.action !== 'restore'} onClose={() => setConfirm(null)} onConfirm={act} />
      )}
    </>
  );
}
