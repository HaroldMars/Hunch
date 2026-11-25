import React, { Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Logo from '@shared/Logo.jsx';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider, useApp } from './store.jsx';
import { BottomNav } from './components/ui.jsx';
import { RequestAccount, ChangePassword } from './pages/Auth.jsx';
import { LoginScreen, Onboarding } from '@shared/auth/AuthScreens.jsx';
import { api, setToken, consumeHandoff, ADMIN_URL } from './api.js';
import Timeline from './pages/Timeline.jsx';
import PostPage from './pages/PostPage.jsx';
import Chats from './pages/Chats.jsx';
import ChatRoom from './pages/ChatRoom.jsx';
import ChatInfo from './pages/ChatInfo.jsx';
import Connect from './pages/Connect.jsx';
import Profile, { EditProfile, StoryArchive } from './pages/Profile.jsx';
import Notifications from './pages/Notifications.jsx';
import Search from './pages/Search.jsx';
import Settings from './pages/Settings.jsx';
import TripTracker from './components/TripTracker.jsx';
import PermissionsPrompt from './components/Permissions.jsx';
const MapPage = lazy(() => import('./pages/Map.jsx'));
import './styles.css';

consumeHandoff(); // session passed over from the admin dashboard, if any
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } } });

function Intro() {
  return <div className="intro"><Logo size={110} color="#fff" /></div>;
}

function Shell() {
  const { booting, session, setSession, ready, user, logout, settings } = useApp();
  const [introDone, setIntroDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setIntroDone(true), 1100);
    return () => clearTimeout(t);
  }, []);
  if (booting || !introDone) return <Intro />;

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginScreen api={api} appKind="client" otherAppUrl={ADMIN_URL} settings={{ ...settings, requestAccountHref: '/request-account' }}
          onSession={(res, remember) => { setToken(res.token, remember); setSession(res); }} />} />
        <Route path="/request-account" element={<RequestAccount />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  if (!ready) return <Onboarding api={api} session={session} setSession={setSession} logout={logout} />;

  return (
    <div className="shell">
      <Routes>
        <Route path="/" element={<Timeline />} />
        <Route path="/post/:id" element={<PostPage />} />
        <Route path="/connect" element={<Connect />} />
        <Route path="/chats" element={<Chats />} />
        <Route path="/chats/:id" element={<ChatRoom />} />
        <Route path="/chats/:id/info" element={<ChatInfo />} />
        <Route path="/map" element={<Suspense fallback={<div className="page" />}><MapPage /></Suspense>} />
        <Route path="/me" element={<Navigate to={`/u/${user.id}${location.search}`} replace />} />
        <Route path="/u/:id" element={<Profile />} />
        <Route path="/edit-profile" element={<EditProfile />} />
        <Route path="/archive" element={<StoryArchive />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/search" element={<Search />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/:section" element={<Settings />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <NavGate />
      <TripTracker />
      <PermissionsPrompt />
    </div>
  );
}

// Hide the floating nav inside a conversation.
function NavGate() {
  const { pathname } = useLocation();
  if (/^\/(chats|post)\/\d+/.test(pathname) || pathname === '/map') return null; // map has its own back button
  return <BottomNav />;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppProvider>
          <Shell />
        </AppProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
