import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { api } from '../api.js';
import { useApp } from '../store.jsx';
import { Avatar, HeaderActions, Spinner, Empty } from '../components/ui.jsx';
import { PostCard, Composer } from '../components/Post.jsx';
import { StoryBar, StoryViewer } from '../components/Stories.jsx';
import StoryComposer from '../components/StoryComposer.jsx';
import WorkTab from './Work.jsx';

export default function Timeline() {
  const { user, settings } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tab, setTabState] = useState(params.get('tab') === 'work' ? 'work' : 'foryou');
  const workView = params.get('view') || undefined;
  const setTab = (t) => { setTabState(t); if (params.get('tab')) setParams({}, { replace: true }); };
  const [posts, setPosts] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
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
  const load = async (t = tab) => {
    setPosts(null);
    const r = await api(`/posts/feed?tab=${t}`);
    setPosts(r.posts);
    setNextBefore(r.nextBefore);
  };
  useEffect(() => { if (tab !== 'work') load(tab); }, [tab]);
  useEffect(() => { loadStories(); }, []);

  const more = async () => {
    setLoadingMore(true);
    const r = await api(`/posts/feed?tab=${tab}&before=${nextBefore}`);
    setPosts((p) => [...p, ...r.posts]);
    setNextBefore(r.nextBefore);
    setLoadingMore(false);
  };

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
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
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
          {posts.map((p) => <PostCard key={p.id} post={p} onDeleted={(id) => setPosts(posts.filter((x) => x.id !== id))} />)}
          {nextBefore && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn ghost sm" onClick={more} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button></div>}
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
