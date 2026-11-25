import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { api } from '../api.js';
import { useAdmin, PageHead, Spinner, Empty, Modal, ago, fmtDate, useLoad } from '../ui.jsx';

const STYLE = {
  daily_report: { icon: 'report', color: '#5b8def', group: 'reports' },
  new_user: { icon: 'userPlus', color: '#1baf7a', group: 'system' },
  account_request: { icon: 'users', color: '#a78bfa', group: 'system' },
  password_reset: { icon: 'key', color: '#ff8a3d', group: 'system' },
  announcement: { icon: 'megaphone', color: '#e0a100', group: 'system' },
  app_update: { icon: 'refresh', color: '#2ec4b6', group: 'system' },
  email: { icon: 'mail', color: '#7c8db5', group: 'system' },
  system: { icon: 'shield', color: '#7c8db5', group: 'system' },
  report: { icon: 'shield', color: '#e5484d', group: 'system' },
  support: { icon: 'comment', color: '#2ec4b6', group: 'system' },
  post_permission: { icon: 'briefcase', color: '#5b8def', group: 'system' },
};

function Announce({ onClose, onDone }) {
  const { user, toast } = useAdmin();
  const [f, setF] = useState({ title: '', body: '', kind: 'announcement', audience: 'everyone' });
  const send = async () => {
    try {
      await api('/admin/announcements', { method: 'POST', body: f });
      toast('Announcement published', 'success');
      onDone(); onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal title="New system announcement" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={!f.title.trim() || !f.body.trim()} onClick={send}><Icon name="megaphone" size={15} /> Publish</button></>}>
      <label className="label">Type</label>
      <select className="select input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
        <option value="announcement">System announcement</option>
        {user.role === 'developer' && <option value="app_update">App update</option>}
      </select>
      <label className="label">Audience</label>
      <select className="select input" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>
        <option value="everyone">Everyone</option><option value="users">Hunch users only</option><option value="staff">Hunch staff only</option>
      </select>
      <label className="label">Title</label><input className="input" value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <label className="label">Message</label><textarea className="input" rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      <p className="small muted">Delivered instantly as an in-app notification to every recipient.</p>
    </Modal>
  );
}

export default function Notifications() {
  const { user, toast, refreshCounts, onNotification } = useAdmin();
  const nav = useNavigate();
  const [tab, setTab] = useState('all');
  const [list, setList] = useState(null);
  const [announcing, setAnnouncing] = useState(false);
  const [detail, setDetail] = useState(null);
  const today = useLoad(() => api('/admin/reports/daily'), []);
  const anns = useLoad(() => api('/admin/announcements'), []);
  const load = () => api('/notifications').then(setList);
  useEffect(() => { load(); }, []);
  useEffect(() => onNotification((n) => setList((l) => (l ? [n, ...l] : l))), []);
  const canAnnounce = ['developer', 'sysadmin', 'employee', 'operations'].includes(user.role);

  const open = (n) => {
    if (!n.is_read) { api(`/notifications/${n.id}/read`, { method: 'POST' }).then(refreshCounts); setList((l) => l.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x))); }
    if (n.type === 'account_request') nav('/register');
    else if (n.type === 'password_reset') nav('/users?tab=resets');
    else if (n.type === 'email') nav('/email');
    else setDetail(n);
  };
  const shown = (list || []).filter((n) => tab === 'all' || (STYLE[n.type]?.group || 'system') === tab);
  const s = today.data;
  return (
    <>
      <PageHead title="Notifications" sub="Daily reports and system activity">
        <button className="btn ghost sm" onClick={async () => { await api('/notifications/read-all', { method: 'POST' }); load(); refreshCounts(); }}><Icon name="checks" size={15} /> Mark all read</button>
        {canAnnounce && <button className="btn ghost sm" onClick={async () => { const r = await api('/admin/reports/daily/generate', { method: 'POST' }); toast(`Daily report sent to ${r.sent} staff`, 'success'); load(); }}><Icon name="report" size={15} /> Send today’s report</button>}
        {canAnnounce && <button className="btn sm" onClick={() => setAnnouncing(true)}><Icon name="megaphone" size={15} /> Announcement</button>}
      </PageHead>

      {s && (
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <div className="card stat"><div className="k">Today’s participation</div><div className="v">{s.participationPct}%</div><div className="d">{s.participants} of {s.activeUsers} logged a mood</div></div>
          <div className="card stat"><div className="k">Active today</div><div className="v">{s.present}</div><div className="d">People who used Hunch today</div></div>
          <div className="card stat"><div className="k">Top moods today</div><div className="v" style={{ fontSize: 22 }}>{s.topMoods.length ? s.topMoods.map((m) => m.emoji).join(' ') : '-'}</div><div className="d">{s.topMoods.map((m) => `${m.label} ${m.pct}%`).join(' · ') || 'No moods yet'}</div></div>
          <div className="card stat"><div className="k">Team mood trend</div><div className="v" style={{ fontSize: 22, textTransform: 'capitalize' }}>{s.trend === 'improving' ? '↗' : s.trend === 'declining' ? '↘' : '→'} {s.trend}</div><div className="d">vs. the previous 7 days{s.positivePct !== null ? ` · ${s.positivePct}% positive` : ''}</div></div>
        </div>
      )}

      <div className="grid g3">
        <div className="card span2">
          <div className="tabs">
            {[['all', 'All'], ['reports', 'Daily reports'], ['system', 'System']].map(([k, v]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{v}</button>)}
          </div>
          {!list ? <Spinner /> : !shown.length ? <Empty icon="bell" title="No notifications">Daily reports arrive each evening; system events show up here as they happen.</Empty> : shown.map((n) => {
            const st = STYLE[n.type] || STYLE.system;
            return (
              <div key={n.id} className={`notif-row ${n.is_read ? '' : 'unread'}`} onClick={() => open(n)} style={{ cursor: 'pointer' }}>
                <div className="ic" style={{ background: st.color }}><Icon name={st.icon} size={18} /></div>
                <div style={{ flex: 1, minWidth: 0 }}><div className="t">{n.title}</div><div className="b">{n.body}</div><div className="m">{ago(n.created_at)}{n.actor_name ? ` · ${n.actor_name}` : ''}</div></div>
                {!n.is_read && <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--primary)', marginTop: 6 }} />}
              </div>
            );
          })}
        </div>
        <div className="card">
          <h3>Announcements</h3>
          <p className="hint">Recent system announcements and app updates</p>
          {anns.loading ? <Spinner /> : !anns.data.length ? <p className="muted small">None yet.</p> : anns.data.slice(0, 12).map((a) => (
            <div key={a.id} className="notif-row" style={{ padding: '10px 0' }}>
              <div style={{ minWidth: 0 }}>
                <span className={`tag ${a.kind === 'app_update' ? 'blue' : 'amber'}`}>{a.kind === 'app_update' ? 'App update' : 'Announcement'}</span> <span className="tag">{a.audience}</span>
                <div className="t" style={{ marginTop: 6 }}>{a.title}</div><div className="b small">{a.body}</div><div className="m">{a.author} · {fmtDate(a.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {announcing && <Announce onClose={() => setAnnouncing(false)} onDone={() => { anns.reload(); load(); }} />}
      {detail && (
        <Modal title={detail.title} onClose={() => setDetail(null)}>
          <p style={{ lineHeight: 1.6 }}>{detail.body}</p>
          {detail.data?.topMoods && (
            <div className="mood-legend" style={{ marginBottom: 12 }}>
              {detail.data.topMoods.map((m) => <div key={m.mood} className="row"><span>{m.emoji}</span><span>{m.label}</span><div className="bar"><i style={{ width: `${m.pct}%` }} /></div><b>{m.pct}%</b></div>)}
            </div>
          )}
          <p className="small muted">{fmtDate(detail.created_at)}</p>
        </Modal>
      )}
    </>
  );
}
