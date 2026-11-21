import { useEffect, useRef, useState } from 'react';
import Icon from '@shared/Icon.jsx';
import { api } from '../api.js';
import { Sheet, Spinner } from './ui.jsx';

export const DEFAULT_CENTER = [10.3157, 123.8854]; // Cebu City
export const TRAFFIC = [
  { label: 'Fast flow', color: '#1baf7a' },
  { label: 'Moderate', color: '#f59e0b' },
  { label: 'Heavy traffic', color: '#e5484d' },
];
export const MODES = [
  { key: 'walk', icon: 'walk', label: 'Walking', emoji: '🚶' },
  { key: 'motorcycle', icon: 'bike', label: 'Motorcycle', emoji: '🏍️' },
  { key: 'car', icon: 'car', label: 'Car', emoji: '🚗' },
];
export const fmtDist = (m) => (m == null ? '-' : m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`);
export const fmtDur = (s) => {
  if (s == null) return '-';
  const min = Math.max(1, Math.round(s / 60));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ''}`.trim();
};
export const clock = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** Browser geolocation as a promise. Works on http://localhost (a secure context). */
export function currentPosition(opts = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser can’t share location.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.latitude, p.coords.longitude]),
      (e) => reject(new Error(e.code === 1 ? 'Location permission was denied. Allow it in your browser’s site settings.' : 'Couldn’t get your location. Try again or search for a place.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000, ...opts }
    );
  });
}

/** Debounced OpenStreetMap place search. */
export function PlaceSearch({ placeholder = 'Search a place', near, onPick, autoFocus }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const seq = useRef(0);
  useEffect(() => {
    if (q.trim().length < 2) { setList(null); setErr(''); return undefined; }
    const id = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const qs = new URLSearchParams({ q: q.trim(), ...(near ? { lat: near[0], lng: near[1] } : {}) });
        const r = await api(`/map/search?${qs}`);
        if (id === seq.current) { setList(r); setErr(''); }
      } catch (e) { if (id === seq.current) setErr(e.message); } finally { if (id === seq.current) setBusy(false); }
    }, 550);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="place-search">
      <div className="search-bar"><Icon name="search" size={18} /><input autoFocus={autoFocus} placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label={placeholder} />{busy && <span className="mini-spin" />}</div>
      {err && <div className="error-text small">{err}</div>}
      {list && !list.length && !busy && <p className="small muted" style={{ margin: '8px 4px' }}>No places found.</p>}
      {list?.map((p, i) => (
        <button key={`${p.lat},${p.lng},${i}`} className="place-row" onClick={() => { onPick(p); setQ(''); setList(null); }}>
          <span className="pin-ic"><Icon name="location" size={17} /></span>
          <span className="meta"><b>{p.name}</b><small>{p.display}</small></span>
        </button>
      ))}
    </div>
  );
}

/** Pick a location for a story: current location (reverse geocoded) or search. */
export function LocationTagSheet({ onPick, onClose, sharing }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const here = async () => {
    setBusy(true); setErr('');
    try {
      const [lat, lng] = await currentPosition();
      const p = await api(`/map/reverse?lat=${lat}&lng=${lng}`);
      onPick(p); onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Add location" onClose={onClose}>
      {sharing === 'private' && <div className="hint-box"><Icon name="lock" size={16} /> Your location is private, so only you will see this tag. Change it in Settings → Privacy → Location.</div>}
      <button className="place-row" onClick={here} disabled={busy}>
        <span className="pin-ic blue"><Icon name="crosshair" size={17} /></span>
        <span className="meta"><b>{busy ? 'Finding you…' : 'Use current location'}</b><small>Uses your browser’s location</small></span>
        {busy && <Spinner />}
      </button>
      {err && <div className="error-text small">{err}</div>}
      <div style={{ marginTop: 10 }}><PlaceSearch autoFocus placeholder="Search a place, e.g. Ayala Center Cebu" onPick={(p) => { onPick(p); onClose(); }} /></div>
    </Sheet>
  );
}
