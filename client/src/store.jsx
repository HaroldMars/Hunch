import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, getToken, setToken, setAuthIssueHandler, API_BASE } from './api.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const readTheme = () => {
  try { return localStorage.getItem('hunch_theme') || 'dark'; } catch { return 'dark'; }
};

export function AppProvider({ children }) {
  const [session, setSession] = useState(null); // {user, modules, next}
  const [booting, setBooting] = useState(true);
  const [theme, setThemeState] = useState(readTheme);
  const [toasts, setToasts] = useState([]);
  const [unread, setUnread] = useState({ count: 0, messages: 0 });
  const [settings, setSettings] = useState({});
  const socketRef = useRef(null);
  const listeners = useRef(new Map());

  // theme: 'dark' | 'light' | 'system' (follows the device).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme; };
    apply();
    try { localStorage.setItem('hunch_theme', theme); } catch { /* ignore */ }
    if (theme !== 'system') return undefined;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  const [prefs, setPrefs] = useState(null);

  const toast = useCallback((msg, type = 'info') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setSession(null);
    socketRef.current?.disconnect();
    socketRef.current = null;
  }, []);

  const refreshMe = useCallback(async () => {
    if (!getToken()) return setSession(null);
    try {
      setSession(await api('/auth/me'));
    } catch (e) {
      if (e.status === 401) logout();
    }
  }, [logout]);

  useEffect(() => {
    setAuthIssueHandler((status) => {
      if (status === 401) logout();
      else refreshMe(); // 428: onboarding step required
    });
    api('/auth/public-settings').then((s) => s && setSettings(s)).catch(() => {});
    refreshMe().finally(() => setBooting(false));
  }, [logout, refreshMe]);

  const login = async (identifier, password) => {
    const res = await api('/auth/login', { method: 'POST', body: { identifier, password, app: 'client' } });
    setToken(res.token);
    setSession(res);
    return res;
  };

  const ready = !!session && !session.next;
  useEffect(() => { if (ready) api('/users/me/settings').then(setPrefs).catch(() => {}); }, [ready]);
  const updatePrefs = useCallback(async (patch) => { const p = await api('/users/me/settings', { method: 'PATCH', body: patch }); setPrefs(p); return p; }, []);

  const refreshUnread = useCallback(() => {
    api('/notifications/unread-count').then(setUnread).catch(() => {});
  }, []);

  // Realtime connection once onboarding is complete.
  useEffect(() => {
    if (!ready) return undefined;
    const s = io(API_BASE || undefined, { auth: { token: getToken() }, transports: ['websocket', 'polling'] });
    socketRef.current = s;
    const relay = (event) => (data) => (listeners.current.get(event) || new Set()).forEach((fn) => fn(data));
    ['message:new', 'message:update', 'message:read', 'typing', 'notification:new', 'conversation:update', 'mood:update',
      'call:ring', 'call:ended', 'call:peer-joined', 'call:peer-left', 'call:left', 'call:signal', 'call:declined', 'call:answered-elsewhere', 'call:media',
    ].forEach((ev) => s.on(ev, relay(ev)));
    s.on('notification:new', refreshUnread);
    refreshUnread();
    return () => s.disconnect();
  }, [ready, refreshUnread]);

  const on = useCallback((event, fn) => {
    if (!listeners.current.has(event)) listeners.current.set(event, new Set());
    listeners.current.get(event).add(fn);
    return () => listeners.current.get(event).delete(fn);
  }, []);
  // `ack` (optional) receives the server's reply, for request/response events like starting a call.
  const emit = useCallback((event, data, ack) => (ack ? socketRef.current?.emit(event, data, ack) : socketRef.current?.emit(event, data)), []);

  const value = useMemo(() => ({
    session, setSession, user: session?.user, booting, ready, login, logout, refreshMe,
    theme, setTheme: setThemeState, toast, unread, refreshUnread, on, emit, settings, prefs, updatePrefs,
  }), [session, booting, ready, logout, refreshMe, theme, toast, unread, refreshUnread, on, emit, settings, prefs, updatePrefs]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}
      </div>
    </Ctx.Provider>
  );
}

/** Subscribe to a realtime event for the lifetime of a component. */
export function useSocket(event, handler) {
  const { on } = useApp();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => on(event, (d) => ref.current(d)), [on, event]);
}
