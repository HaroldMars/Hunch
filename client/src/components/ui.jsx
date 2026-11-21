import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import Icon from '@shared/Icon.jsx';
import { MOODS, THEMES } from '@shared/constants.js';
import { useApp } from '../store.jsx';

export function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export const clockTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
export const listTime = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return clockTime(iso);
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export function Avatar({ user, src, size = 40, online, onClick }) {
  const url = src ?? user?.avatar;
  return (
    <div className="avatar" style={{ width: size, height: size, cursor: onClick ? 'pointer' : undefined }} onClick={onClick}>
      {url ? <img src={url} alt="" /> : <Icon name="user" size={size * 0.62} stroke={1.5} />}
      {online && <span className="online" />}
    </div>
  );
}

export function Sheet({ title, onClose, children, footer, center, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className={`overlay ${center ? 'center' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} style={wide ? { maxWidth: 520 } : undefined}>
        {!center && <div className="grabber" />}
        {title !== undefined && (
          <div className="sheet-head">
            <h3>{title}</h3>
            <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
          </div>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={title} onClose={onClose} center
      footer={<div style={{ display: 'flex', gap: 8 }}>
        <button className="btn ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className={`btn ${danger ? 'danger' : ''}`} style={{ flex: 1 }} disabled={busy}
          onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>{confirmLabel}</button>
      </div>}>
      <p style={{ margin: 0, color: 'var(--text-2)' }}>{message}</p>
    </Sheet>
  );
}

export const Spinner = () => <div className="spinner" aria-label="Loading" />;

export function Empty({ icon = 'sparkle', title, children }) {
  return (
    <div className="empty">
      <div className="icon"><Icon name={icon} size={28} /></div>
      {title && <h4>{title}</h4>}
      <div className="small">{children}</div>
    </div>
  );
}

export function Lightbox({ src, onClose }) {
  if (!src) return null;
  return (
    <div className="lightbox" onClick={onClose}>
      <button className="icon-btn" aria-label="Close"><Icon name="close" /></button>
      <img src={src} alt="" />
    </div>
  );
}

export function MoodPicker({ value, onChange }) {
  return (
    <div className="mood-grid">
      {MOODS.map((m) => (
        <button key={m.key} type="button" className={`mood-btn ${value === m.key ? 'active' : ''}`} style={{ '--mood': m.color }}
          onClick={() => onChange(value === m.key ? null : m.key)} aria-pressed={value === m.key}>
          <span>{m.emoji}</span><span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}

export function ThemePicker({ value, onChange }) {
  return (
    <div className="theme-row">
      {THEMES.map((t) => (
        <button key={t.key} type="button" title={t.label} aria-label={t.label} className={`theme-swatch ${value === t.key ? 'active' : ''}`}
          style={{ background: t.css }} onClick={() => onChange(t.key)} />
      ))}
    </div>
  );
}

export function FilePreviews({ files, onRemove }) {
  const [urls, setUrls] = useState([]);
  useEffect(() => {
    const u = files.map((f) => URL.createObjectURL(f));
    setUrls(u);
    return () => u.forEach(URL.revokeObjectURL);
  }, [files]);
  if (!files.length) return null;
  return (
    <div className="file-previews">
      {urls.map((u, i) => (
        <div key={u}><img src={u} alt="" /><button type="button" onClick={() => onRemove(i)} aria-label="Remove"><Icon name="close" size={14} /></button></div>
      ))}
    </div>
  );
}

export function TopBar({ title, back, children }) {
  const nav = useNavigate();
  return (
    <div className="topbar">
      {back && <button className="icon-btn" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))} aria-label="Back"><Icon name="back" /></button>}
      {typeof title === 'string' ? (back ? <h2>{title}</h2> : <h1>{title}</h1>) : title}
      <div className="spacer" />
      {children}
    </div>
  );
}

export function HeaderActions() {
  const { user, unread } = useApp();
  const nav = useNavigate();
  return (
    <>
      <button className="icon-btn" onClick={() => nav('/notifications')} aria-label="Notifications">
        <Icon name="bell" size={25} />
        {unread.count > 0 && <span className="badge">{unread.count > 99 ? '99+' : unread.count}</span>}
      </button>
      <button className="icon-btn" onClick={() => nav(`/u/${user.id}`)} aria-label="My profile">
        <Avatar user={user} size={30} />
      </button>
    </>
  );
}

export function BottomNav() {
  const { unread } = useApp();
  const items = [
    { to: '/', icon: 'home', label: 'Home' },
    { to: '/connect', icon: 'cards', label: 'Connect' },
    { to: '/map', icon: 'map', label: 'Map' },
    { to: '/chats', icon: 'chat', label: 'Chat', dot: unread.messages > 0 },
    { to: '/me', icon: 'user', label: 'Profile' },
  ];
  return (
    <nav className="bottom-nav" aria-label="Main">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.to === '/'} aria-label={i.label} title={i.label}>
          <Icon name={i.icon} size={26} stroke={1.5} />
          {i.dot && <span className="dot" />}
        </NavLink>
      ))}
    </nav>
  );
}

export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const reload = () => {
    setState((s) => ({ ...s, loading: true }));
    return fn().then((data) => setState({ data, loading: false, error: null })).catch((error) => setState({ data: null, loading: false, error }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, deps);
  return { ...state, reload, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}
