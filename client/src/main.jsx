import React, { Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Logo from '@shared/Logo.jsx';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider, useApp } from './store.jsx';
import { BottomNav } from './components/ui.jsx';
import { ChangePassword } from './pages/Auth.jsx';
import { LoginScreen, Onboarding, WelcomeScreen } from '@shared/auth/AuthScreens.jsx';
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
import CallLayer from './components/Calls.jsx';
const MapPage = lazy(() => import('./pages/Map.jsx'));
import './styles.css';

consumeHandoff(); // session passed over from the admin dashboard, if any
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } } });

function Intro() {
  return <div className="intro"><Logo size={110} color="#fff" /></div>;
}

// First visit: Welcome → Get Started (sign up) or Sign In. Returning visitors go straight to sign in.
const WELCOMED = 'hunch_welcomed';
const welcomed = () => { try { return localStorage.getItem(WELCOMED) === '1'; } catch { return false; } };
const markWelcomed = () => { try { localStorage.setItem(WELCOMED, '1'); } catch { /* private mode */ } };

function SignedOut() {
  const { setSession, settings } = useApp();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const go = (path) => { markWelcomed(); nav(path); };
  const auth = (mode) => (
    <LoginScreen api={api} appKind="client" otherAppUrl={ADMIN_URL} settings={settings} allowSignup initialMode={mode}
      onModeChange={(m) => m !== 'forgot' && nav(m === 'signup' ? '/signup' : '/login', { replace: true })}
      onBack={() => nav('/welcome')}
      onSession={(res, remember) => { markWelcomed(); setToken(res.token, remember); setSession(res); }} />
  );
  return (
    <Routes>
      <Route path="/welcome" element={<WelcomeScreen onStart={() => go('/signup')} onSignIn={() => go('/login')} />} />
      <Route path="/login" element={auth('login')} />
      <Route path="/signup" element={auth('signup')} />
      <Route path="*" element={<Navigate to={welcomed() || pathname !== '/' ? '/login' : '/welcome'} replace />} />
    </Routes>
  );
}

function Shell() {
  const { booting, session, setSession, ready, user, logout, settings } = useApp();
  const [introDone, setIntroDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setIntroDone(true), 1100);
    return () => clearTimeout(t);
  }, []);
  if (booting || !introDone) return <Intro />;

  if (!session) return <SignedOut />;
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
      <CallLayer />
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
