import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { api } from '../api.js';
import { Avatar, TopBar, Spinner, Empty } from '../components/ui.jsx';
import { FriendButton } from './Connect.jsx';

export default function Search() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!q.trim()) { setResults(null); return undefined; }
    setLoading(true);
    const t = setTimeout(() => api(`/users/search?q=${encodeURIComponent(q.trim())}`).then(setResults).finally(() => setLoading(false)), 250);
    return () => clearTimeout(t);
  }, [q]);
  const update = (id, relation) => setResults((r) => r.map((u) => (u.id === id ? { ...u, relation } : u)));
  return (
    <div className="page">
      <TopBar title="Search" back />
      <div className="search-bar"><Icon name="search" size={20} stroke={2.2} />
        <input autoFocus placeholder="Full name or user ID (e.g. HN100002)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" style={{ fontSize: 15 }} />
        {q && <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setQ('')} aria-label="Clear"><Icon name="close" size={16} /></button>}
      </div>
      <div style={{ marginTop: 10 }}>
        {loading && !results ? <Spinner /> : results === null ? (
          <Empty icon="search" title="Find people">Search by full name or user ID. Exact matches appear first.</Empty>
        ) : !results.length ? <Empty icon="user" title="No results">No one matches “{q}”.</Empty> : results.map((u) => (
          <div key={u.id} className="row-item">
            <Avatar user={u} size={48} onClick={() => nav(`/u/${u.id}`)} />
            <div className="meta" onClick={() => nav(`/u/${u.id}`)} style={{ cursor: 'pointer' }}>
              <div className="title">{u.full_name}{u.exact && <span className="chip" style={{ padding: '1px 7px', fontSize: 10.5, color: 'var(--primary)' }}>Exact match</span>}</div>
              <div className="sub">{u.username ? `@${u.username}` : u.user_code}{u.job_title ? ` · ${u.job_title}` : ''}{u.location ? ` · ${u.location}` : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {u.relation === 'self' ? <span className="chip">You</span> : <FriendButton user={u} relation={u.relation} onChange={(r) => update(u.id, r)} compact />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
