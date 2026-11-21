import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useApp, useSocket } from '../store.jsx';

/** Keeps an active trip's position up to date while the app is open (any page). */
export default function TripTracker() {
  const { toast, session } = useApp();
  const [trip, setTrip] = useState(null);
  const last = useRef({ t: 0, pos: null });
  useEffect(() => { if (session) api('/trips/mine/active').then(setTrip).catch(() => {}); }, [session]);
  useSocket('trip:update', (t) => { if (t.mine) setTrip(t.status === 'active' ? t : null); if (t.mine && t.status === 'arrived') toast(`You’ve arrived at ${t.dest.name} 🎉`, 'success'); });
  useSocket('trip:remove', ({ id }) => setTrip((t) => (t?.id === id ? null : t)));
  useEffect(() => {
    if (!trip || !navigator.geolocation) return undefined;
    const id = navigator.geolocation.watchPosition((p) => {
      const pos = [p.coords.latitude, p.coords.longitude];
      const now = Date.now();
      const moved = !last.current.pos || Math.hypot(pos[0] - last.current.pos[0], pos[1] - last.current.pos[1]) > 0.00025;
      if (now - last.current.t < 8000 || !moved) return;
      last.current = { t: now, pos };
      api(`/trips/${trip.id}/position`, { method: 'POST', body: { lat: pos[0], lng: pos[1] } }).catch(() => {});
    }, () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [trip?.id]);
  return null;
}
