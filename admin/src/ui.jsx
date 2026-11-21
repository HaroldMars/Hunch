import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import Icon from '@shared/Icon.jsx';
import { api, getToken, setToken, setAuthIssueHandler, API_BASE } from './api.js';

// ---------- app state ----------
const Ctx = createContext(null);
export const useAdmin = () => useContext(Ctx);
const readTheme = () => { try { return localStorage.getItem('hunch_admin_theme') || 'dark'; } catch { return 'dark'; } };

export function AdminProvider({ children }) {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);
  const [theme, setTheme] = useState(readTheme);
  const [toasts, setToasts] = useState([]);
  const [unread, setUnread] = useState(0);
  const [emailUnread, setEmailUnread] = useState(0);
  const listeners = useRef(new Set());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('hunch_admin_theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const toast = useCallback((msg, type = 'info') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  const logout = useCallback(() => { setToken(null); setSession(null); }, []);
  const refreshMe = useCallback(async () => {
    if (!getToken()) return setSession(null);
    try { setSession(await api('/auth/me')); } catch (e) { if (e.status === 401 || e.status === 403) logout(); }
  }, [logout]);

  useEffect(() => {
    setAuthIssueHandler((status) => (status === 401 ? logout() : refreshMe()));
    refreshMe().finally(() => setBooting(false));
  }, [logout, refreshMe]);

  const ready = !!session && !session.next;
  const refreshCounts = useCallback(() => {
    api('/notifications/unread-count').then((r) => setUnread(r.count)).catch(() => {});
    if (session?.modules?.includes('email')) api('/admin/email/counts').then((r) => setEmailUnread(r.inbox)).catch(() => {});
  }, [session]);

  useEffect(() => {
    if (!ready) return undefined;
    refreshCounts();
    const s = io(API_BASE || undefined, { auth: { token: getToken() }, transports: ['websocket', 'polling'] });
    s.on('notification:new', (n) => {
      if (n.audience !== 'admin') return;
      refreshCounts();
      listeners.current.forEach((fn) => fn(n));
      toast(n.title || 'New notification');
    });
    return () => s.disconnect();
  }, [ready, refreshCounts, toast]);

  const onNotification = useCallback((fn) => { listeners.current.add(fn); return () => listeners.current.delete(fn); }, []);

  const can = (m) => !!session?.modules?.includes(m);

  const value = useMemo(() => ({
    session, setSession, user: session?.user, booting, ready, logout, theme, setTheme, toast, unread, emailUnread, refreshCounts, onNotification, can,
  }), [session, booting, ready, logout, theme, toast, unread, emailUnread, refreshCounts, onNotification]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
    </Ctx.Provider>
  );
}

// ---------- components ----------
export function Avatar({ user, size = 32 }) {
  const initials = (user?.full_name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {user?.avatar ? <img src={user.avatar} alt="" /> : initials}
    </div>
  );
}
export const Spinner = () => <div className="spinner" aria-label="Loading" />;
export function Empty({ icon = 'sparkle', title, children }) {
  return <div className="empty"><Icon name={icon} size={30} /><h4>{title}</h4><div className="small">{children}</div></div>;
}
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
export function Confirm({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className={`btn ${danger ? 'danger' : ''}`} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>{confirmLabel}</button>
    </>}>
      <p style={{ color: 'var(--text-2)' }}>{message}</p>
    </Modal>
  );
}
export function PageHead({ title, sub, children }) {
  return <div className="page-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div><div className="spacer" />{children}</div>;
}
export function Switch({ on, onChange, label, disabled }) {
  return <button type="button" role="switch" aria-checked={!!on} aria-label={label} disabled={disabled} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}
export function CopySecret({ value }) {
  const { toast } = useAdmin();
  return (
    <div className="secret"><span>{value}</span>
      <button className="btn sm ghost" onClick={() => { navigator.clipboard?.writeText(value); toast('Copied'); }}>Copy</button>
    </div>
  );
}
export function useLoad(fn, deps) {
  const [s, set] = useState({ data: null, loading: true, error: null });
  const reload = () => { set((x) => ({ ...x, loading: true })); return fn().then((data) => set({ data, loading: false, error: null })).catch((error) => set({ data: null, loading: false, error })); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, deps);
  return { ...s, reload, setData: (d) => set((x) => ({ ...x, data: typeof d === 'function' ? d(x.data) : d })) };
}
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-');
export const ago = (iso) => {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localDay(d); };
