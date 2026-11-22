import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import Logo from '@shared/Logo.jsx';
import { ROLE_LABELS } from '@shared/constants.js';
import { AdminProvider, useAdmin, Avatar, Spinner } from './ui.jsx';
import { LoginScreen, Onboarding } from '@shared/auth/AuthScreens.jsx';
import { api, setToken, consumeHandoff, CLIENT_URL } from './api.js';
import Statistics from './pages/Statistics.jsx';
import Reports, { TeamReport } from './pages/Reports.jsx';
import Workspace from './pages/Workspace.jsx';
import Email from './pages/Email.jsx';
import Notifications from './pages/Notifications.jsx';
import Registration from './pages/Registration.jsx';
import Users, { Admins } from './pages/Users.jsx';
import Teams, { TeamView } from './pages/Teams.jsx';
import Settings, { Account } from './pages/Settings.jsx';
import './styles.css';

consumeHandoff(); // session passed over from the Hunch app sign-in, if any

const NAV = [
  { to: '/', mod: 'stats', icon: 'chart', label: 'Statistics' },
  { to: '/reports', mod: 'reports', icon: 'report', label: 'Reports' },
  { to: '/workspace', mod: 'workspace', icon: 'briefcase', label: 'Workspace' },
  { to: '/email', mod: 'email', icon: 'mail', label: 'Email', count: 'email' },
  { to: '/notifications', mod: 'notifications', icon: 'bell', label: 'Notifications', count: 'notif' },
  { to: '/register', mod: 'register', icon: 'userPlus', label: 'Registration' },
  { to: '/teams', mod: 'teams', icon: 'layers', label: 'Team Management', staffLabel: 'My Team' },
  { to: '/users', mod: 'users', icon: 'users', label: 'User Management' },
  { to: '/admins', mod: 'admins', icon: 'shield', label: 'Admin Management' },
  { to: '/settings', mod: 'settings', icon: 'settings', label: 'System Settings' },
];

function Layout() {
  const { user, can, unread, emailUnread, theme, setTheme, logout } = useAdmin();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const items = NAV.filter((n) => can(n.mod));
  // Staff are also members of the social app: hand the session over in a new tab.
  const openApp = async () => {
    const r = await api('/auth/handoff', { method: 'POST', body: { app: 'client' } });
    window.open(`${CLIENT_URL}#handoff=${encodeURIComponent(r.token)}&r=0`, '_blank', 'noopener');
  };
  return (
    <div className="layout">
      <aside className={`sidebar ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
        <div className="brand"><Logo size={30} /><div>Hunch<small>Admin Dashboard</small></div></div>
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className="nav-item">
            <Icon name={n.icon} size={19} /> {n.staffLabel && ['tl', 'sme'].includes(user.role) ? n.staffLabel : n.label}
            {n.count === 'notif' && unread > 0 && <span className="count">{unread > 99 ? '99+' : unread}</span>}
            {n.count === 'email' && emailUnread > 0 && <span className="count">{emailUnread}</span>}
          </NavLink>
        ))}
        <div className="grow" />
        <button className="nav-item" style={{ border: 0, background: 'none', textAlign: 'left' }} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={19} /> {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        <button className="nav-item" style={{ border: 0, background: 'none', textAlign: 'left' }} onClick={openApp}><Icon name="globe" size={19} /> Open Hunch app</button>
        <NavLink to="/account" className="nav-item"><Icon name="key" size={19} /> My account</NavLink>
        <button className="nav-item" style={{ border: 0, background: 'none', textAlign: 'left' }} onClick={logout}><Icon name="logout" size={19} /> Sign out</button>
        <div className="me-card" style={{ marginTop: 8 }}>
          <Avatar user={user} size={34} />
          <div style={{ minWidth: 0 }}><div className="n">{user.full_name}</div><div className="r">{ROLE_LABELS[user.role]} · {user.user_code}</div></div>
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        <div className="mobile-bar">
          <button className="icon-btn" onClick={() => setOpen(!open)} aria-label="Menu"><Icon name="menu" /></button>
          <Logo size={22} /> <b>Hunch Admin</b>
        </div>
        <main className="main" key={loc.pathname.split('/')[1]}>
          <Routes>
            {can('stats') && <Route path="/" element={<Statistics />} />}
            {can('reports') && <Route path="/reports" element={<Reports />} />}
            {can('reports') && <Route path="/reports/:id" element={<TeamReport />} />}
            {can('workspace') && <Route path="/workspace" element={<Workspace />} />}
            {can('email') && <Route path="/email" element={<Email />} />}
            {can('notifications') && <Route path="/notifications" element={<Notifications />} />}
            {can('register') && <Route path="/register" element={<Registration />} />}
            {can('teams') && <Route path="/teams" element={<Teams />} />}
            {can('teams') && <Route path="/teams/:id" element={<TeamView />} />}
            {can('users') && <Route path="/users" element={<Users />} />}
            {can('admins') && <Route path="/admins" element={<Admins />} />}
            {can('settings') && <Route path="/settings" element={<Settings />} />}
            <Route path="/account" element={<Account />} />
            <Route path="*" element={<Navigate to={items[0]?.to || '/account'} replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function Root() {
  const { booting, session, setSession, ready, logout } = useAdmin();
  const [settings, setSettings] = useState({});
  useEffect(() => { api('/auth/public-settings').then((s) => setSettings(s || {})).catch(() => {}); }, []);
  if (booting) return <Spinner />;
  if (!session) {
    return <LoginScreen api={api} appKind="admin" otherAppUrl={CLIENT_URL} settings={settings}
      onSession={(res, remember) => { setToken(res.token, remember); setSession(res); }} />;
  }
  if (!ready) return <Onboarding api={api} session={session} setSession={setSession} logout={logout} />;
  return <Layout />;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AdminProvider><Root /></AdminProvider>
    </BrowserRouter>
  </React.StrictMode>
);
