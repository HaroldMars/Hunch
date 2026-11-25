import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Icon from '@shared/Icon.jsx';
import { moodByKey } from '@shared/constants.js';
import { api } from '../api.js';
import { useApp, useSocket } from '../store.jsx';
import { Avatar, Sheet, Spinner, timeAgo, useLoad } from '../components/ui.jsx';
import { StoryViewer } from '../components/Stories.jsx';
import { PlaceSearch, currentPosition, DEFAULT_CENTER, TRAFFIC, MODES, fmtDist, fmtDur, clock } from '../components/Places.jsx';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const avatarHtml = (u) => `<span class="pin-ava">${u?.avatar ? `<img src="${esc(u.avatar)}" alt=""/>` : `<b>${esc(u?.full_name?.[0] || '?')}</b>`}</span>`;
const modeOf = (k) => MODES.find((m) => m.key === k) || MODES[2];
const first = (u) => u?.full_name?.split(' ')[0] || '';
const short = (iso) => timeAgo(iso).replace('now', 'now');

/** Group location stories into places (same name within ~150 m). */
function groupPlaces(stories) {
  const out = [];
  for (const s of stories) {
    const g = out.find((p) => p.name === s.place_name && Math.abs(p.lat - s.lat) < 0.0015 && Math.abs(p.lng - s.lng) < 0.0015);
    if (g) g.stories.push(s);
    else out.push({ key: `${s.place_name}|${s.lat.toFixed(3)}|${s.lng.toFixed(3)}`, name: s.place_name, lat: s.lat, lng: s.lng, stories: [s] });
  }
  return out;
}

export default function MapPage() {
  const { user, toast, prefs, updatePrefs } = useApp();
  const [params, setParams] = useSearchParams();
  const box = useRef(null);
  const map = useRef(null);
  const layers = useRef({});
  const [data, setData] = useState(null);
  // Docked bottom panel: friends | stories | place | person | spot | start | trip
  const [dock, setDock] = useState({ view: 'friends' });
  // Draggable bottom sheet: peek (search only) · half · full. "expanded" = above peek.
  const SNAPS = () => [104, Math.round(window.innerHeight * 0.45), Math.round(window.innerHeight * 0.82)];
  const [sheetH, setSheetH] = useState(104);
  const [dragging, setDragging] = useState(false);
  const expanded = sheetH > 120;
  const setExpanded = (v) => setSheetH(v === 'full' ? SNAPS()[2] : v ? SNAPS()[1] : SNAPS()[0]);
  const drag = useRef(null);
  const onDragStart = (e) => {
    drag.current = { y: e.clientY, h: sheetH, moved: false };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onDragMove = (e) => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.y;
    if (Math.abs(dy) > 4) drag.current.moved = true;
    setSheetH(Math.max(80, Math.min(window.innerHeight * 0.88, drag.current.h - dy)));
  };
  const onDragEnd = () => {
    if (!drag.current) return;
    const { moved, h } = drag.current;
    drag.current = null;
    setDragging(false);
    setSheetH((cur) => {
      const snaps = SNAPS();
      if (!moved) return h > 120 ? snaps[0] : snaps[1]; // a tap on the handle toggles
      return snaps.reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a));
    });
  };
  const [zoomCls, setZoomCls] = useState('z-near');
  const nav = useNavigate();
  const [modal, setModal] = useState(null); // 'privacy' | 'credits'
  const [viewer, setViewer] = useState(null);
  const [me, setMe] = useState(null);
  const [picking, setPicking] = useState(null);
  const pickRef = useRef(null);
  pickRef.current = picking;
  const [draft, setDraft] = useState({ mode: 'car', origin: null, dest: null, shared: false });
  const fitted = useRef(false);

  const load = () => api('/map/overview').then(setData).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);
  useSocket('trip:update', (t) => setData((d) => d && { ...d, trips: [t, ...d.trips.filter((x) => x.id !== t.id)].filter((x) => x.status === 'active') }));
  useSocket('trip:remove', ({ id }) => setData((d) => d && { ...d, trips: d.trips.filter((x) => x.id !== id) }));
  useSocket('location:update', (l) => setData((d) => d && { ...d, people: [{ ...l, me: l.user_id === user.id }, ...d.people.filter((x) => x.user_id !== l.user_id)] }));
  useSocket('location:remove', ({ user_id }) => setData((d) => d && { ...d, people: d.people.filter((x) => x.user_id !== user_id) }));

  // Friends list rests at peek height; detail views open to half; the ride panel opens tall.
  const open = (view, extra = {}, exp = false) => { setDock({ view, ...extra }); setExpanded(view === 'start' ? 'full' : view === 'friends' && !exp ? false : true); };
  const flyTo = (lat, lng, z = 16) => map.current?.flyTo([lat, lng], z, { duration: 0.8 });

  // ---------- map ----------
  useEffect(() => {
    // Minimal controls: pinch / scroll to zoom. The OpenStreetMap credit lives behind the ⓘ button.
    const m = L.map(box.current, { zoomControl: false, attributionControl: false, minZoom: 5, worldCopyJump: true }).setView(DEFAULT_CENTER, 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m);
    layers.current = { stories: L.layerGroup().addTo(m), people: L.layerGroup().addTo(m), trips: L.layerGroup().addTo(m), me: L.layerGroup().addTo(m) };
    const zc = () => { const z = m.getZoom(); setZoomCls(z >= 13 ? 'z-near' : z >= 11 ? 'z-mid' : 'z-far'); };
    m.on('zoomend', zc);
    m.on('click', async (e) => {
      const which = pickRef.current;
      if (!which) return;
      setPicking(null);
      const { lat, lng } = e.latlng;
      let place = { name: 'Pinned location', lat, lng };
      try { place = await api(`/map/reverse?lat=${lat}&lng=${lng}`); } catch { /* generic name */ }
      setDraft((d) => ({ ...d, [which]: place }));
      open('start', {}, true);
    });
    map.current = m;
    setTimeout(() => m.invalidateSize(), 50);
    return () => { m.remove(); map.current = null; };
  }, []);

  const places = useMemo(() => groupPlaces(data?.stories || []), [data]);

  // Story clusters: photo tile + "📸 N Stories · Place".
  useEffect(() => {
    const g = layers.current.stories;
    if (!g) return;
    g.clearLayers();
    places.forEach((p) => {
      const latest = p.stories[0];
      const mood = moodByKey(latest.mood);
      const html = `<div class="pin-story">
        <div class="ps-tile">${latest.image ? `<img src="${esc(latest.image)}" alt=""/>` : `<span style="background:${mood?.color || '#5b8def'}">${mood?.emoji || '✨'}</span>`}</div>
        <div class="pin-label"><b>📸 ${p.stories.length} ${p.stories.length === 1 ? 'Story' : 'Stories'}</b><span>📍 ${esc(p.name)}</span></div></div>`;
      L.marker([p.lat, p.lng], { icon: L.divIcon({ html, className: 'mk', iconSize: [120, 96], iconAnchor: [60, 66] }) })
        .on('click', () => { open('place', { place: p }, true); flyTo(p.lat, p.lng, 15); }).addTo(g);
    });
  }, [places]);

  // People: the profile photo is the pin.
  useEffect(() => {
    const g = layers.current.people;
    if (!g) return;
    g.clearLayers();
    (data?.people || []).forEach((p) => {
      const html = `<div class="pin-person ${p.me ? 'me' : ''}">${avatarHtml(p.user)}<div class="pin-label"><b>${p.me ? 'You' : esc(first(p.user))}</b><span>${esc(short(p.updated_at))}</span></div></div>`;
      L.marker([p.lat, p.lng], { icon: L.divIcon({ html, className: 'mk', iconSize: [110, 84], iconAnchor: [55, 28] }), zIndexOffset: 500 })
        .on('click', () => open('person', { person: p })).addTo(g);
    });
  }, [data]);

  // Trips: my route in traffic colours; friends only as a moving avatar.
  useEffect(() => {
    const g = layers.current.trips;
    if (!g) return;
    g.clearLayers();
    (data?.trips || []).forEach((t) => {
      const md = modeOf(t.mode);
      if (t.mine && t.route) {
        let start = 0;
        for (let i = 1; i <= t.levels.length; i++) {
          if (i === t.levels.length || t.levels[i] !== t.levels[start]) {
            const color = t.mode === 'walk' ? '#5b8def' : TRAFFIC[t.levels[start] ?? 0].color;
            L.polyline(t.route.slice(start, i + 1), { color: '#fff', weight: 10, opacity: 0.9, lineCap: 'round' }).addTo(g);
            L.polyline(t.route.slice(start, i + 1), { color, weight: 6, opacity: 1, dashArray: t.mode === 'walk' ? '2 9' : null, lineCap: 'round' }).addTo(g);
            start = i;
          }
        }
        L.marker([t.dest.lat, t.dest.lng], { icon: L.divIcon({ className: 'mk', html: '<div class="pin-dest"><span></span></div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(g);
      }
      L.marker([t.current.lat, t.current.lng], {
        icon: L.divIcon({ className: 'mk', html: `<div class="pin-person ${t.mine ? 'me' : ''}">${avatarHtml(t.user)}<i class="pin-mode">${md.emoji}</i></div>`, iconSize: [56, 56], iconAnchor: [28, 28] }),
        zIndexOffset: 800,
      }).on('click', () => open('trip', { id: t.id })).addTo(g);
    });
  }, [data]);

  useEffect(() => {
    if (!data || fitted.current || !map.current) return;
    fitted.current = true;
    // From a story's location card: /map?story=<id> opens that place.
    const storyFocus = Number(params.get('story'));
    const place = storyFocus && places.find((p) => p.stories.some((s) => s.id === storyFocus));
    if (storyFocus) {
      setParams({}, { replace: true });
      if (place) { map.current.setView([place.lat, place.lng], 15); open('place', { place }, true); return; }
      toast('That story isn’t on the Map anymore.');
    }
    const focus = Number(params.get('trip'));
    if (focus) setParams({}, { replace: true });
    const trip = data.trips.find((t) => t.id === focus) || data.trips.find((t) => t.mine);
    if (focus && !data.trips.some((t) => t.id === focus)) api(`/trips/${focus}`).then((t) => (t.status === 'active' ? setData((d) => ({ ...d, trips: [t, ...d.trips] })) : toast('That trip has ended.'))).catch(() => toast('That trip is no longer shared.'));
    if (trip) {
      if (trip.route) map.current.fitBounds(L.latLngBounds(trip.route).pad(0.3)); else map.current.setView([trip.current.lat, trip.current.lng], 15);
      open('trip', { id: trip.id });
      return;
    }
    const pts = [...data.stories.map((s) => [s.lat, s.lng]), ...data.people.map((p) => [p.lat, p.lng])];
    if (pts.length) map.current.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 14, paddingBottomRight: [0, 160] });
  }, [data]);

  const locate = async () => {
    try {
      const pos = await currentPosition();
      setMe(pos);
      const g = layers.current.me;
      g.clearLayers();
      L.marker(pos, { icon: L.divIcon({ className: 'mk', html: '<div class="pin-me"><span></span></div>', iconSize: [44, 44], iconAnchor: [22, 22] }), zIndexOffset: 900 }).addTo(g);
      flyTo(pos[0], pos[1], 15);
      return pos;
    } catch (e) { toast(e.message, 'error'); return null; }
  };

  const myTrip = data?.trips.find((t) => t.mine);
  const sharing = data?.sharing || prefs?.location_sharing || 'private';
  const navigate = () => (myTrip ? open('trip', { id: myTrip.id }, true) : open('start', {}, true));
  const shareBack = async () => {
    try {
      if (sharing !== 'friends') await updatePrefs({ location_sharing: 'friends' });
      const pos = me || await locate();
      if (!pos) return;
      await api('/map/location', { method: 'PUT', body: { lat: pos[0], lng: pos[1] } });
      toast('Sharing your location with friends', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };
  const openStories = (list, startUserId) => {
    const byUser = [];
    list.forEach((x) => { const g = byUser.find((y) => y.user.id === x.user.id); if (g) g.stories.push(x); else byUser.push({ user: x.user, stories: [x] }); });
    byUser.forEach((g) => g.stories.sort((a, b) => a.id - b.id));
    setViewer({ groups: byUser, start: Math.max(0, byUser.findIndex((g) => g.user.id === startUserId)) });
  };

  const trip = dock.view === 'trip' ? data?.trips.find((t) => t.id === dock.id) : null;

  return (
    <div className={`map-page mp ${zoomCls}`}>
      <div ref={box} className="map-canvas" />

      <div className="mp-top">
        <div className="mp-row">
          <button className="mp-round" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))} aria-label="Back"><Icon name="back" size={21} /></button>
          <TopSearch data={data} places={places} near={me}
            onPlace={(p) => { flyTo(p.lat, p.lng); open('spot', { spot: p }); }}
            onStoryPlace={(p) => { flyTo(p.lat, p.lng, 15); open('place', { place: p }, true); }}
            onPerson={(p) => { flyTo(p.lat, p.lng); open('person', { person: p }); }} />
          <button className="mp-round" onClick={() => setModal('privacy')} aria-label="Location settings"><Icon name="settings" size={21} /></button>
        </div>
        <button className={`mp-status ${sharing}`} onClick={() => setModal('privacy')}>
          <i /> {sharing === 'friends' ? 'Sharing with friends' : 'Not sharing location'}
        </button>
        <div className="mp-actions">
          <button onClick={locate}><Icon name="crosshair" size={18} /><span>Current</span></button>
          <button onClick={navigate} className={myTrip ? 'live' : ''}><Icon name="navigate" size={18} /><span>{myTrip ? 'My Trip' : 'Navigate'}</span></button>
          <button onClick={() => open('friends', {}, true)} className={dock.view === 'friends' && expanded ? 'on' : ''}><Icon name="users" size={18} /><span>Friends</span></button>
          <button onClick={() => open('stories', {}, true)} className={dock.view === 'stories' && expanded ? 'on' : ''}><Icon name="sparkle" size={18} /><span>Stories</span></button>
        </div>
      </div>

      {picking && <div className="pick-banner"><Icon name="location" size={16} /> Tap the map to set your {picking === 'dest' ? 'destination' : 'starting point'} <button onClick={() => { setPicking(null); open('start', {}, true); }}>Cancel</button></div>}
      {!data && <div className="map-loading"><Spinner /></div>}
      <button className="map-info" onClick={() => setModal('credits')} aria-label="Map information">i</button>

      {/* ---------- Docked panel ---------- */}
      <div className={`mp-dock ${dragging ? 'dragging' : ''}`} style={{ height: sheetH }}>
        <div className="mp-grab" role="slider" aria-label="Drag to resize panel" aria-valuenow={Math.round(sheetH)} tabIndex={0}
          onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
          onKeyDown={(e) => { if (e.key === 'ArrowUp') setExpanded('full'); if (e.key === 'ArrowDown') setExpanded(false); }}><span /></div>
        <div className="mp-dock-body">
          {myTrip && !['trip', 'start'].includes(dock.view) && <TripPill trip={myTrip} onOpen={() => open('trip', { id: myTrip.id }, true)} />}
          {dock.view === 'friends' && <FriendsPanel data={data} sharing={sharing} onFocus={(p) => { flyTo(p.lat, p.lng); open('person', { person: p }); }} onShareBack={shareBack} onExpand={() => setExpanded(true)} />}
          {dock.view === 'stories' && <StoriesPanel places={places} onPlace={(p) => { flyTo(p.lat, p.lng, 15); open('place', { place: p }, true); }} />}
          {dock.view === 'place' && <PlacePanel place={dock.place} me={user} onBack={() => open('stories', {}, true)} onOpen={(s) => openStories(dock.place.stories, s.user.id)} />}
          {dock.view === 'person' && (
            <PersonPanel p={dock.person} onBack={() => open('friends')}
              onDirections={() => { setDraft((d) => ({ ...d, dest: { name: dock.person.place_name || dock.person.user.full_name, lat: dock.person.lat, lng: dock.person.lng } })); open('start', {}, true); }}
              onStop={async () => { await api('/map/location', { method: 'DELETE' }); toast('Stopped sharing your location'); open('friends'); load(); }} />
          )}
          {dock.view === 'spot' && (
            <div className="mp-panel">
              <PanelHead title={dock.spot.name} sub={dock.spot.display} onBack={() => open('friends')} />
              <button className="btn block" onClick={() => { setDraft((d) => ({ ...d, dest: dock.spot })); open('start', {}, true); }}><Icon name="navigate" size={17} /> Directions</button>
            </div>
          )}
          {dock.view === 'start' && (
            <RidePanel draft={draft} setDraft={setDraft} sharing={sharing} near={me} onBack={() => open('friends')}
              onPickOnMap={(which) => { setExpanded(false); setPicking(which); }}
              onStarted={(t) => { setData((d) => ({ ...d, trips: [t, ...d.trips.filter((x) => x.id !== t.id)] })); setDraft({ mode: draft.mode, origin: null, dest: null, shared: false }); map.current.fitBounds(L.latLngBounds(t.route).pad(0.3)); open('trip', { id: t.id }); }} />
          )}
          {dock.view === 'trip' && trip && (
            <TripPanel trip={trip} sharing={sharing} onBack={() => open('friends')} onFit={() => trip.route && map.current.fitBounds(L.latLngBounds(trip.route).pad(0.3))}
              onEnded={() => { setData((d) => ({ ...d, trips: d.trips.filter((t) => t.id !== trip.id) })); open('friends'); }}
              onChange={(t) => setData((d) => ({ ...d, trips: d.trips.map((x) => (x.id === t.id ? t : x)) }))} />
          )}
          {dock.view === 'trip' && !trip && <div className="mp-panel"><PanelHead title="Trip ended" onBack={() => open('friends')} /></div>}
        </div>
      </div>

      {modal === 'privacy' && (
        <LocationPrivacy sharing={sharing} onClose={() => setModal(null)}
          onChange={async (v) => { await updatePrefs({ location_sharing: v }); toast(v === 'friends' ? 'Friends can now see your location' : 'Location is private'); load(); }}
          onShareNow={async () => { await shareBack(); setModal(null); }} />
      )}
      {modal === 'credits' && (
        <Sheet title="Map information" onClose={() => setModal(null)}>
          <p style={{ marginTop: 0 }}>Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>, available under the Open Database License.</p>
          <p className="small muted" style={{ marginBottom: 0 }}>Routes by OSRM / OpenRouteService. Traffic colours are estimated from time of day and road type.</p>
        </Sheet>
      )}
      {viewer && <StoryViewer groups={viewer.groups} startGroup={viewer.start} onClose={() => setViewer(null)} onChanged={load} />}
    </div>
  );
}

// ---------- top search: places, people, tagged locations ----------
function TopSearch({ data, places, near, onPlace, onStoryPlace, onPerson }) {
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const [remote, setRemote] = useState(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const nav = useNavigate();
  const friends = useLoad(() => api('/friends'), []);
  const term = q.trim().toLowerCase();
  useEffect(() => {
    if (term.length < 2) { setRemote(null); return undefined; }
    const id = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try { const r = await api(`/map/search?${new URLSearchParams({ q: q.trim(), ...(near ? { lat: near[0], lng: near[1] } : {}) })}`); if (id === seq.current) setRemote(r); } catch { if (id === seq.current) setRemote([]); } finally { if (id === seq.current) setBusy(false); }
    }, 550);
    return () => clearTimeout(t);
  }, [term]);
  const people = term ? (friends.data || []).filter((f) => f.full_name.toLowerCase().includes(term)).slice(0, 4) : [];
  const tagged = term ? places.filter((p) => p.name.toLowerCase().includes(term)).slice(0, 3) : [];
  const pick = (fn) => { fn(); setQ(''); setFocus(false); };
  const show = focus && term.length > 0;
  return (
    <div className="mp-search">
      <div className="mp-search-bar">
        <Icon name="search" size={19} />
        <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 200)} placeholder="Search location..." aria-label="Search places, people and tagged locations" />
        {busy ? <span className="mini-spin" /> : q && <button onClick={() => setQ('')} aria-label="Clear search"><Icon name="close" size={16} /></button>}
      </div>
      {show && (
        <div className="mp-results">
          {people.length > 0 && <div className="mp-rh">People</div>}
          {people.map((f) => {
            const loc = data?.people.find((p) => p.user_id === f.id);
            return (
              <button key={`u${f.id}`} className="mp-res" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(() => (loc ? onPerson(loc) : nav(`/u/${f.id}`)))}>
                <Avatar user={f} size={34} /><span><b>{f.full_name}</b><small>{loc ? `${loc.place_name || 'Shared location'} · ${short(loc.updated_at)}` : 'Not sharing location · view profile'}</small></span>
              </button>
            );
          })}
          {tagged.length > 0 && <div className="mp-rh">Tagged locations</div>}
          {tagged.map((p) => (
            <button key={p.key} className="mp-res" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(() => onStoryPlace(p))}>
              <span className="mp-ic">📸</span><span><b>{p.name}</b><small>{p.stories.length} {p.stories.length === 1 ? 'story' : 'stories'}</small></span>
            </button>
          ))}
          {remote?.length > 0 && <div className="mp-rh">Places</div>}
          {remote?.map((p, i) => (
            <button key={`p${i}`} className="mp-res" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(() => onPlace(p))}>
              <span className="mp-ic"><Icon name="location" size={17} /></span><span><b>{p.name}</b><small>{p.display}</small></span>
            </button>
          ))}
          {!busy && remote && !remote.length && !people.length && !tagged.length && <p className="mp-none">No results for “{q}”.</p>}
        </div>
      )}
    </div>
  );
}

function PanelHead({ title, sub, onBack, right }) {
  return (
    <div className="mp-head">
      {onBack && <button className="mp-back" onClick={onBack} aria-label="Back"><Icon name="back" size={18} /></button>}
      <div className="mp-head-t"><b>{title}</b>{sub && <small>{sub}</small>}</div>
      {right}
    </div>
  );
}

function FriendsPanel({ data, sharing, onFocus, onShareBack, onExpand }) {
  const [q, setQ] = useState('');
  const list = (data?.people || []).filter((p) => !p.me && p.user.full_name.toLowerCase().includes(q.toLowerCase()));
  const mine = data?.people.find((p) => p.me);
  return (
    <div className="mp-panel">
      <div className="mp-filter"><Icon name="search" size={18} /><input placeholder="Search for friends..." value={q} onFocus={onExpand} onChange={(e) => setQ(e.target.value)} aria-label="Search for friends" /></div>
      {!data ? <Spinner /> : !list.length ? (
        <p className="mp-none">{q ? 'No friends match.' : 'No friends are sharing their location right now.'}</p>
      ) : list.map((p) => (
        <div key={p.user_id} className="mp-friend" onClick={() => onFocus(p)}>
          <Avatar user={p.user} size={48} />
          <div className="m"><b>{p.user.full_name}</b><small>{short(p.updated_at)} ago · {p.place_name || 'Shared location'}</small></div>
          {sharing !== 'friends' || !mine
            ? <button className="mp-btn" onClick={(e) => { e.stopPropagation(); onShareBack(); }}>Share back</button>
            : <button className="mp-btn ghost" onClick={(e) => { e.stopPropagation(); onFocus(p); }}>View</button>}
        </div>
      ))}
    </div>
  );
}

function StoriesPanel({ places, onPlace }) {
  return (
    <div className="mp-panel">
      <PanelHead title="Stories nearby" sub={`${places.reduce((n, p) => n + p.stories.length, 0)} stories from friends, by location`} />
      {!places.length ? <p className="mp-none">No location-tagged stories yet. Add 📍 Location when you share a Mood Story.</p> : places.map((p) => (
        <button key={p.key} className="mp-place" onClick={() => onPlace(p)}>
          <div className="mp-thumb">{p.stories[0].image ? <img src={p.stories[0].image} alt="" /> : <span>{moodByKey(p.stories[0].mood)?.emoji || '✨'}</span>}</div>
          <div className="m"><b>📸 {p.stories.length} {p.stories.length === 1 ? 'Story' : 'Stories'}</b><small>📍 {p.name}</small></div>
          <div className="mp-faces">{[...new Map(p.stories.map((s) => [s.user.id, s.user])).values()].slice(0, 3).map((u) => <Avatar key={u.id} user={u} size={24} />)}</div>
        </button>
      ))}
    </div>
  );
}

function PlacePanel({ place, me, onBack, onOpen }) {
  return (
    <div className="mp-panel">
      <PanelHead title={`📍 ${place.name}`} sub={`${place.stories.length} ${place.stories.length === 1 ? 'story' : 'stories'} available`} onBack={onBack} />
      <div className="mp-story-grid">
        {place.stories.map((s) => {
          const m = moodByKey(s.mood);
          return (
            <button key={s.id} className="mp-story" onClick={() => onOpen(s)}>
              <div className="bg" style={{ background: s.image ? '#000' : m?.color }}>{s.image ? <img src={s.image} alt="" /> : <span>{m?.emoji || '✨'}</span>}</div>
              <div className="ov"><Avatar user={s.user} size={22} /><b>{s.user.id === me.id ? 'You' : first(s.user)}</b></div>
              <div className="ft">{m && <span className="mdot" style={{ background: m.color }} />}{m?.label}{s.text ? ` · ${s.text}` : ''}<small>{short(s.created_at)} ago</small></div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PersonPanel({ p, onBack, onDirections, onStop }) {
  const nav = useNavigate();
  return (
    <div className="mp-panel">
      <div className="mp-person">
        <button className="mp-back" onClick={onBack} aria-label="Back"><Icon name="back" size={18} /></button>
        <Avatar user={p.user} size={56} />
        <div className="m"><b>{p.me ? 'You' : p.user.full_name}</b><small>{short(p.updated_at)} ago · {p.place_name || 'Shared location'}</small></div>
      </div>
      <div className="mp-two">
        <button className="btn ghost" onClick={() => nav(`/u/${p.user.id}`)}>Profile</button>
        {p.me ? <button className="btn" onClick={onStop}>Stop sharing</button> : <button className="btn" onClick={onDirections}><Icon name="navigate" size={16} /> Directions</button>}
      </div>
    </div>
  );
}

function TripPill({ trip, onOpen }) {
  const md = modeOf(trip.mode);
  return (
    <button className="mp-trip-pill" onClick={onOpen}>
      <span className="e">{md.emoji}</span>
      <span className="m"><b>{fmtDur(trip.eta)} · {fmtDist(trip.remaining)}</b><small>to {trip.dest.name}</small></span>
      <span className="t">{clock(trip.arrive_at)}</span>
    </button>
  );
}

/** Clean ride panel: current location → destination, mode, ETA. */
function RidePanel({ draft, setDraft, sharing, near, onBack, onPickOnMap, onStarted }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [editing, setEditing] = useState(draft.dest ? null : 'dest');
  const useHere = async () => {
    setLocating(true);
    try {
      const [lat, lng] = await currentPosition();
      let p = { name: 'Current location', lat, lng };
      try { const r = await api(`/map/reverse?lat=${lat}&lng=${lng}`); p = { ...r, name: r.name || p.name }; } catch { /* generic */ }
      setDraft((d) => ({ ...d, origin: { ...p, current: true } }));
    } catch (e) { toast(e.message, 'error'); } finally { setLocating(false); }
  };
  useEffect(() => { if (!draft.origin) useHere(); }, []);
  useEffect(() => { if (draft.dest && editing === 'dest') setEditing(null); }, [draft.dest]);
  const start = async () => {
    setBusy(true);
    try { onStarted(await api('/trips', { method: 'POST', body: draft })); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const label = (v, fb) => (v ? (v.current ? 'Current Location' : v.name) : fb);
  return (
    <div className="mp-panel">
      <PanelHead title="Destination" onBack={onBack} />
      <div className="ride">
        <div className="ride-rail"><i className="a" /><span /><i className="b" /></div>
        <div className="ride-fields">
          <button className={`ride-f ${editing === 'origin' ? 'on' : ''}`} onClick={() => setEditing(editing === 'origin' ? null : 'origin')}>
            <small>From</small><b>{locating ? 'Locating…' : label(draft.origin, 'Choose starting point')}</b>
          </button>
          <button className={`ride-f ${editing === 'dest' ? 'on' : ''}`} onClick={() => setEditing(editing === 'dest' ? null : 'dest')}>
            <small>To</small><b className={draft.dest ? '' : 'ph'}>{label(draft.dest, 'Where to?')}</b>
          </button>
        </div>
      </div>
      {editing && (
        <div className="ride-pick">
          <PlaceSearch autoFocus near={near || (draft.origin && [draft.origin.lat, draft.origin.lng])} placeholder={editing === 'dest' ? 'Search destination' : 'Search starting point'}
            onPick={(p) => { setDraft((d) => ({ ...d, [editing]: p })); setEditing(null); }} />
          <div className="ride-links">
            {editing === 'origin' && <button onClick={useHere}><Icon name="crosshair" size={15} /> Current location</button>}
            <button onClick={() => onPickOnMap(editing)}><Icon name="location" size={15} /> Choose on map</button>
          </div>
        </div>
      )}
      <div className="ride-modes">
        {MODES.map((m) => <button key={m.key} className={draft.mode === m.key ? 'on' : ''} onClick={() => setDraft((d) => ({ ...d, mode: m.key }))}><span>{m.emoji}</span>{m.label === 'Walking' ? 'Walk' : m.label}</button>)}
      </div>
      <label className={`ride-share ${sharing !== 'friends' ? 'off' : ''}`}>
        <input type="checkbox" disabled={sharing !== 'friends'} checked={draft.shared && sharing === 'friends'} onChange={(e) => setDraft((d) => ({ ...d, shared: e.target.checked }))} />
        <span>Share my live position with friends{sharing !== 'friends' ? ' (turn on location sharing first)' : ''}</span>
      </label>
      <button className="btn block" disabled={!draft.origin || !draft.dest || busy} onClick={start}>{busy ? 'Finding route…' : 'Start'}</button>
    </div>
  );
}

function TripPanel({ trip, sharing, onBack, onFit, onEnded, onChange }) {
  const { toast } = useApp();
  const nav = useNavigate();
  const md = modeOf(trip.mode);
  if (!trip.mine) {
    return (
      <div className="mp-panel">
        <div className="mp-person">
          <button className="mp-back" onClick={onBack} aria-label="Back"><Icon name="back" size={18} /></button>
          <Avatar user={trip.user} size={56} />
          <div className="m"><b>{first(trip.user)} is on the move {md.emoji}</b><small>{md.label} · updated {short(trip.updated_at)} ago</small></div>
        </div>
        <p className="mp-note"><Icon name="lock" size={12} /> Only {first(trip.user)} can see their route and destination.</p>
        <button className="btn ghost block" onClick={() => nav(`/u/${trip.user.id}`)}>View profile</button>
      </div>
    );
  }
  const tr = TRAFFIC[trip.traffic ?? 0];
  const done = trip.distance ? Math.min(100, Math.max(0, Math.round((1 - trip.remaining / trip.distance) * 100))) : 0;
  return (
    <div className="mp-panel">
      <PanelHead title="Destination" sub={trip.dest.name} onBack={onBack} />
      <div className="ride static">
        <div className="ride-rail"><i className="a" /><span /><i className="b" /></div>
        <div className="ride-fields">
          <div className="ride-f"><small>From</small><b>{trip.origin.name}</b></div>
          <div className="ride-f"><small>To</small><b>{trip.dest.name}</b></div>
        </div>
      </div>
      <div className="ride-eta">
        <div><small>ETA</small><b>{fmtDur(trip.eta)}</b></div>
        <div><small>Arrive</small><b>{clock(trip.arrive_at)}</b></div>
        <div><small>Distance</small><b>{fmtDist(trip.remaining)}</b></div>
        <div><small>Mode</small><b>{md.emoji}</b></div>
      </div>
      <div className="trip-progress"><i style={{ width: `${done}%` }} /></div>
      {trip.mode !== 'walk' && (
        <div className="ride-traffic"><span className="mdot" style={{ background: tr.color }} /> {tr.label} now
          <span className="sep" />{TRAFFIC.map((t) => <span key={t.label} className="lg"><i style={{ background: t.color }} />{t.label}</span>)}
        </div>
      )}
      <label className={`ride-share ${sharing !== 'friends' ? 'off' : ''}`}>
        <input type="checkbox" disabled={sharing !== 'friends'} checked={trip.shared}
          onChange={async () => { try { onChange(await api(`/trips/${trip.id}`, { method: 'PATCH', body: { shared: !trip.shared } })); } catch (e) { toast(e.message, 'error'); } }} />
        <span>Share my live position with friends (never your route)</span>
      </label>
      <div className="mp-two">
        <button className="btn ghost" onClick={onFit}>Show route</button>
        <button className="btn danger" onClick={async () => { await api(`/trips/${trip.id}/end`, { method: 'POST' }); toast('Trip ended'); onEnded(); }}>End trip</button>
      </div>
      <p className="mp-note">Traffic is estimated from time of day and road type. Position updates while Hunch is open.</p>
    </div>
  );
}

function LocationPrivacy({ sharing, onClose, onChange, onShareNow }) {
  return (
    <Sheet title="Location sharing" onClose={onClose}>
      {[['friends', 'users', 'Friends only', 'Mutual friends see your profile photo on the map, the places on your stories and your live position on trips you share.'],
        ['private', 'lock', 'Private', 'Nobody can see your location. No pin is shown and anything you shared is removed.']].map(([k, i, l, d]) => (
        <button key={k} className={`choice-card ${sharing === k ? 'on' : ''}`} onClick={() => onChange(k)}>
          <Icon name={i} /><span><b>{l}</b><small>{d}</small></span><span className="radio" />
        </button>
      ))}
      {sharing === 'friends' && <button className="btn block" style={{ marginTop: 12 }} onClick={onShareNow}><Icon name="crosshair" size={17} /> Share my current location</button>}
      <p className="small muted">Hunch never tracks you in the background. Location is only read when you tap a location button or have an active trip.</p>
    </Sheet>
  );
}
