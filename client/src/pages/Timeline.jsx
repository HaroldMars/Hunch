import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { Avatar, HeaderActions, Spinner, Empty } from '../components/ui.jsx';
import { PostCard, Composer } from '../components/Post.jsx';
import { StoryBar, StoryViewer } from '../components/Stories.jsx';
import StoryComposer from '../components/StoryComposer.jsx';
import WorkTab from './Work.jsx';

/** Why a post is in For You: a search, an interest, or because it's popular or new. */
function FeedReason({ r }) {
  const text = r.type === 'search' ? <>Because you searched “{r.term}”</> : r.type === 'interest' ? <>Matches your interest in {r.label}</> : r.type === 'popular' ? 'Popular right now' : 'New';
  const icon = r.type === 'search' ? 'search' : r.type === 'interest' ? 'heart' : r.type === 'popular' ? 'flame' : 'sparkle';
  return <div className={`feed-reason ${r.type}`}><Icon name={icon} size={13} /> {text}</div>;
}

export default function Timeline() {
  const { user, settings } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tab, setTabState] = useState(params.get('tab') === 'work' ? 'work' : 'foryou');
  const workView = params.get('view') || undefined;
  const setTab = (t) => { setTabState(t); if (params.get('tab')) setParams({}, { replace: true }); };
  const [posts, setPosts] = useState(null);
  const [nextBefore, setNextBefore] = useState(null); // Friends: older posts. For You: the next page.
  const [loadingMore, setLoadingMore] = useState(false);
  const seed = useRef(1);
  const sentinel = useRef(null);
  const [stories, setStories] = useState([]);
  const [viewer, setViewer] = useState(null);
  const [creating, setCreating] = useState(false);
  const [composing, setComposing] = useState(false);
  const [hideComposer, setHideComposer] = useState(false);
  // The Work tab is there while Work Mode is on (Settings → Work Mode), whether or not you're on a team yet.
  const hasWork = !!user.work_mode;
  useEffect(() => { if (!hasWork && tab === 'work') setTab('foryou'); }, [hasWork, tab]);

  // Smart posting bar: hides while scrolling down, slides back in when scrolling up.
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y > last + 8 && y > 140) setHideComposer(true);
      else if (y < last - 8 || y < 140) setHideComposer(false);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const loadStories = () => api('/stories').then(setStories).catch(() => {});
  // For You reshuffles on every refresh (new seed): new, popular and posts that match what you search for and like.
  const feedUrl = (t, cursor) => (t === 'foryou' ? `/posts/feed?tab=foryou&seed=${seed.current}&page=${cursor || 0}` : `/posts/feed?tab=${t}${cursor ? `&before=${cursor}` : ''}`);
  const load = async (t = tab) => {
    setPosts(null);
    seed.current = Math.floor(Math.random() * 2 ** 31);
    const r = await api(feedUrl(t));
    setPosts(r.posts);
    setNextBefore(t === 'foryou' ? r.nextPage : r.nextBefore);
  };
  useEffect(() => { if (tab !== 'work') load(tab); }, [tab]);
  useEffect(() => { loadStories(); }, []);

  const more = async () => {
    if (loadingMore || !nextBefore) return;
    setLoadingMore(true);
    try {
      const r = await api(feedUrl(tab, nextBefore));
      setPosts((p) => [...p, ...r.posts.filter((x) => !p.some((y) => y.id === x.id))]);
      setNextBefore(tab === 'foryou' ? r.nextPage : r.nextBefore);
    } finally { setLoadingMore(false); }
  };
  // Keep scrolling: the next page loads as you reach the end.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !nextBefore) return undefined;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && more(), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [nextBefore, tab, posts?.length]);

  return (
    <div className="page flush">
      <div className="smart-header">
        <div className="topbar">
          <button className="icon-btn" onClick={() => nav('/search')} aria-label="Search"><Icon name="search" size={26} stroke={2.2} /></button>
          <div className="spacer" />
          <HeaderActions />
        </div>
        <div className={`smart-composer ${hideComposer ? 'hidden' : ''}`} aria-hidden={hideComposer}>
          <button className="composer-trigger" onClick={() => setComposing(true)} tabIndex={hideComposer ? -1 : 0}>
            <Avatar user={user} size={32} />
            <span style={{ flex: 1 }}>What's on your mind, {user.full_name.split(' ')[0]}?</span>
            <Icon name="image" />
          </button>
        </div>
      </div>
      <div className="smart-spacer" />
      {settings.maintenance_banner && <div className="banner"><Icon name="megaphone" size={18} /> {settings.maintenance_banner}</div>}
      <div className="tabs" role="tablist" style={{ justifyContent: 'center', gap: 40 }}>
        {[['foryou', 'For you'], ['friends', 'Friends'], ...(hasWork ? [['work', 'Work']] : [])].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => (tab === k && k !== 'work' ? (window.scrollTo({ top: 0, behavior: 'smooth' }), load(k)) : setTab(k))}>{l}</button>
        ))}
      </div>
      {tab === 'work' ? (hasWork ? <WorkTab initialView={workView} /> : null) : <>
      <StoryBar groups={stories} onOpen={(i) => setViewer(i)} onCreate={() => setCreating(true)} />
      {posts === null ? <Spinner /> : posts.length === 0 ? (
        <Empty icon="globe" title={tab === 'friends' ? 'No posts from friends yet' : 'Nothing here yet'}>
          {tab === 'friends' ? 'Add friends from the Connect tab to see their posts.' : 'Be the first to share something.'}
        </Empty>
      ) : (
        <>
          {posts.map((p) => (
            <Fragment key={p.id}>
              {p.reason && <FeedReason r={p.reason} />}
              <PostCard post={p} onDeleted={(id) => setPosts(posts.filter((x) => x.id !== id))} />
            </Fragment>
          ))}
          {nextBefore ? <div ref={sentinel} style={{ textAlign: 'center', padding: 16 }}>{loadingMore ? <Spinner /> : <button className="btn ghost sm" onClick={more}>Load more</button>}</div>
            : tab === 'foryou' && posts.length > 5 && <div className="feed-end">You’re all caught up · <button className="link-btn" onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); load('foryou'); }}>Refresh for a new mix</button></div>}
        </>
      )}
      </>}
      {composing && <Composer onClose={() => setComposing(false)} onPosted={(p) => setPosts((x) => [p, ...(x || [])])} />}
      {creating && <StoryComposer onClose={() => setCreating(false)} onCreated={loadStories} />}
      {viewer !== null && stories[viewer] && (
        <StoryViewer groups={stories} startGroup={viewer} onClose={() => { setViewer(null); loadStories(); }} onChanged={loadStories} />
      )}
    </div>
  );
}
