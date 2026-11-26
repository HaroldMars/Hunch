import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { api } from '../api.js';
import { Avatar, TopBar, Spinner, Empty } from '../components/ui.jsx';
import { PostCard } from '../components/Post.jsx';
import { FriendButton } from './Connect.jsx';

/** Search people and posts. Recent searches (only you see them) also tune your For You feed. */
export default function Search() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all'); // all | people | posts
  const [people, setPeople] = useState(null);
  const [posts, setPosts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState([]);
  const [trending, setTrending] = useState([]);
  const input = useRef();
  const term = q.trim();

  const loadRecent = () => api('/search/recent').then(setRecent).catch(() => setRecent([]));
  useEffect(() => { loadRecent(); api('/search/trending').then(setTrending).catch(() => {}); }, []);
  useEffect(() => {
    if (!term) { setPeople(null); setPosts(null); return undefined; }
    setLoading(true);
    const t = setTimeout(() => {
      Promise.all([
        api(`/users/search?q=${encodeURIComponent(term)}`).catch(() => []),
        term.length >= 2 ? api(`/search/posts?q=${encodeURIComponent(term)}`).catch(() => []) : Promise.resolve([]),
      ]).then(([u, p]) => { setPeople(u); setPosts(p); }).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [term]);

  // Remember a search once someone settles on it (Enter, or opening a result).
  const remember = (value = term) => { if (value.length >= 2) api('/search/recent', { method: 'POST', body: { q: value } }).then(loadRecent).catch(() => {}); };
  const pick = (value) => { setQ(value); remember(value); input.current?.blur(); };
  const forget = async (id) => { await api(`/search/recent/${id}`, { method: 'DELETE' }).catch(() => {}); loadRecent(); };
  const clearAll = async () => { await api('/search/recent', { method: 'DELETE' }).catch(() => {}); setRecent([]); };
  const update = (id, relation) => setPeople((r) => r.map((u) => (u.id === id ? { ...u, relation } : u)));

  const personRow = (u) => (
    <div key={u.id} className="row-item">
      <Avatar user={u} size={48} onClick={() => { remember(); nav(`/u/${u.id}`); }} />
      <div className="meta" onClick={() => { remember(); nav(`/u/${u.id}`); }} style={{ cursor: 'pointer' }}>
        <div className="title">{u.full_name}{u.exact && <span className="chip" style={{ padding: '1px 7px', fontSize: 10.5, color: 'var(--primary)' }}>Exact match</span>}</div>
        <div className="sub">{u.username ? `@${u.username}` : u.user_code}{u.job_title ? ` · ${u.job_title}` : ''}{u.location ? ` · ${u.location}` : ''}</div>
      </div>
      {u.relation === 'self' ? <span className="chip">You</span> : <FriendButton user={u} relation={u.relation} onChange={(r) => update(u.id, r)} compact />}
    </div>
  );
  const postList = (list) => <div onClickCapture={() => remember()}>{list.map((p) => <PostCard key={p.id} post={p} onDeleted={(id) => setPosts(posts.filter((x) => x.id !== id))} />)}</div>;

  const nothing = people && posts && !people.length && !posts.length;
  return (
    <div className="page flush search-page">
      <div style={{ padding: '0 16px' }}>
        <TopBar title="Search" back />
        <form className="search-bar" onSubmit={(e) => { e.preventDefault(); remember(); input.current?.blur(); }}>
          <Icon name="search" size={20} stroke={2.2} />
          <input ref={input} autoFocus placeholder="Search people and posts" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people and posts" enterKeyHint="search" style={{ fontSize: 15 }} />
          {q && <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => { setQ(''); input.current?.focus(); }} aria-label="Clear"><Icon name="close" size={16} /></button>}
        </form>
      </div>

      {!term ? (
        <div style={{ padding: '6px 16px 24px' }}>
          {recent.length > 0 && (
            <div className="srch-block">
              <div className="srch-h"><b>Recent</b><button className="link-btn small" onClick={clearAll}>Clear all</button></div>
              {recent.map((r) => (
                <div key={r.id} className="srch-recent">
                  <button onClick={() => pick(r.query)}><Icon name="clock" size={17} /><span>{r.query}</span></button>
                  <button className="icon-btn" onClick={() => forget(r.id)} aria-label={`Remove ${r.query}`}><Icon name="close" size={15} /></button>
                </div>
              ))}
            </div>
          )}
          {trending.length > 0 && (
            <div className="srch-block">
              <div className="srch-h"><b>Trending this week</b></div>
              <div className="srch-trends">{trending.map((t) => <button key={t.term} onClick={() => pick(t.term)}><Icon name="flame" size={14} /> {t.term}<small>{t.posts} posts</small></button>)}</div>
            </div>
          )}
          {!recent.length && !trending.length && <Empty icon="search" title="Search Hunch">Find people by name, username or user ID, and posts by what they say.</Empty>}
          <p className="small muted" style={{ marginTop: 14 }}><Icon name="lock" size={11} /> Only you see your recent searches. They help shape your For You feed.</p>
        </div>
      ) : (
        <>
          <div className="srch-tabs" role="tablist">
            {[['all', 'All'], ['people', `People${people?.length ? ` · ${people.length}` : ''}`], ['posts', `Posts${posts?.length ? ` · ${posts.length}` : ''}`]].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {loading && !people ? <Spinner /> : nothing ? <Empty icon="search" title="No results">Nothing matches “{term}”. Try another name or word.</Empty> : (
            <>
              {tab !== 'posts' && people?.length > 0 && (
                <div style={{ padding: '0 16px' }}>
                  {tab === 'all' && <div className="srch-h"><b>People</b>{people.length > 4 && <button className="link-btn small" onClick={() => setTab('people')}>See all</button>}</div>}
                  {(tab === 'all' ? people.slice(0, 4) : people).map(personRow)}
                </div>
              )}
              {tab === 'people' && !people?.length && <Empty icon="user" title="No people">No one matches “{term}”.</Empty>}
              {tab !== 'people' && posts?.length > 0 && (
                <>
                  {tab === 'all' && <div className="srch-h" style={{ padding: '10px 16px 0' }}><b>Posts</b></div>}
                  {postList(posts)}
                </>
              )}
              {tab === 'posts' && !posts?.length && <Empty icon="image" title="No posts">No posts mention “{term}”.</Empty>}
            </>
          )}
        </>
      )}
    </div>
  );
}
