import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@shared/Icon.jsx';

// Photo crop editor: drag to move, pinch / scroll / slider to zoom, rotate 90°, pick an aspect.
// Runs entirely in the browser and hands back a new JPEG File.

/** Edited files remember the photo they came from, so editing again starts from the full original. */
const originals = new WeakMap();
export const originalOf = (file) => originals.get(file) || file;
/** GIFs would lose their animation, so they're uploaded as they are. */
export const canEdit = (file) => file && /^image\//.test(file.type) && file.type !== 'image/gif';

export const POST_ASPECTS = [
  { label: 'Original', value: 'original' },
  { label: 'Square', value: 1 },
  { label: 'Portrait', value: 4 / 5 },
  { label: 'Wide', value: 16 / 9 },
];

const MAX_ZOOM = 4;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * file: the picked File. aspects: [{label, value}] where value is width/height or 'original'.
 * round: circular guide (profile photos). maxSize: longest output side in px.
 */
// The profile header as people see it (Profile → .pf2): banner 3:1 across the content width
// (app width, max 440px, minus 18px padding each side), a 92px photo overlapping the banner's
// bottom edge, 14px in from the left.
const profileWidth = () => Math.min(typeof window === 'undefined' ? 390 : window.innerWidth, 440) - 36;
const PROFILE_AVATAR = 92;
const PROFILE_INSET = 14;

/**
 * preview: { kind: 'banner' | 'avatar', user } shows a live preview of the profile header with this crop,
 * and on the banner marks where the profile photo covers it.
 */
export default function ImageEditor({ file, title = 'Edit photo', aspects = [{ label: 'Original', value: 'original' }], round = false, maxSize = 2048, doneLabel = 'Done', preview, onCancel, onDone }) {
  const PROFILE_W = profileWidth();
  const stage = useRef();
  const imgRef = useRef();
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const [url, setUrl] = useState(null);
  const [nat, setNat] = useState(null); // natural size of the photo
  const [failed, setFailed] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 }); // stage size
  const [aspect, setAspect] = useState(aspects[0].value);
  const [rot, setRot] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const source = originalOf(file);
  useEffect(() => {
    const u = URL.createObjectURL(source);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [source]);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return undefined;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // Capture phase on document, so Escape closes only the editor and not the sheet behind it.
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel?.(); } };
    document.addEventListener('keydown', k, true);
    return () => document.removeEventListener('keydown', k, true);
  }, [onCancel]);

  // Geometry: the photo's size once rotated, the crop frame inside the stage, and the scale that covers it.
  const turned = rot % 180 !== 0;
  const iw = nat ? (turned ? nat.h : nat.w) : 1;
  const ih = nat ? (turned ? nat.w : nat.h) : 1;
  const ratio = aspect === 'original' ? iw / ih : aspect;
  const pad = 20;
  let fw = Math.max(0, box.w - pad * 2);
  let fh = fw / ratio;
  if (fh > box.h - pad * 2) { fh = Math.max(0, box.h - pad * 2); fw = fh * ratio; }
  const base = Math.max(fw / iw, fh / ih);
  const scale = base * zoom;
  const limit = (o, z = zoom) => {
    const s = base * z;
    const mx = Math.max(0, (iw * s - fw) / 2);
    const my = Math.max(0, (ih * s - fh) / 2);
    return { x: clamp(o.x, -mx, mx), y: clamp(o.y, -my, my) };
  };
  const pos = limit(off); // stays inside the frame when the aspect or screen size changes
  const setZoomTo = (z) => { const nz = clamp(z, 1, MAX_ZOOM); setZoom(nz); setOff((o) => limit(o, nz)); };

  const reset = () => { setZoom(1); setOff({ x: 0, y: 0 }); };
  const pickAspect = (v) => { setAspect(v); reset(); };
  const rotate = () => { setRot((r) => (r + 270) % 360); reset(); };

  const down = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
    setDragging(true);
  };
  const move = (e) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, now);
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      setZoomTo(pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / (pinch.current.dist || 1)));
    } else {
      setOff((o) => limit({ x: o.x + now.x - prev.x, y: o.y + now.y - prev.y }));
    }
  };
  const up = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (!pointers.current.size) setDragging(false);
  };
  const wheel = (e) => setZoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));

  const done = async () => {
    if (!nat || !fw) return;
    setBusy(true);
    try {
      // Output covers the source pixels inside the frame, capped at maxSize on the long side.
      const srcW = fw / scale;
      const srcH = fh / scale;
      const k = Math.min(1, maxSize / Math.max(srcW, srcH)) / scale; // canvas px per frame px
      const ow = Math.max(1, Math.round(fw * k));
      const oh = Math.max(1, Math.round(fh * k));
      const c = document.createElement('canvas');
      c.width = ow; c.height = oh;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, ow, oh);
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(ow / 2 + pos.x * k, oh / 2 + pos.y * k);
      ctx.rotate((rot * Math.PI) / 180);
      const dw = nat.w * scale * k;
      const dh = nat.h * scale * k;
      ctx.drawImage(imgRef.current, -dw / 2, -dh / 2, dw, dh);
      const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not save the photo.'))), 'image/jpeg', 0.9));
      const name = `${(source.name || 'photo').replace(/\.[^.]+$/, '')}.jpg`;
      const out = new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
      originals.set(out, source);
      onDone(out);
    } catch {
      setFailed(true);
    } finally { setBusy(false); }
  };

  const zoomPct = ((zoom - 1) / (MAX_ZOOM - 1)) * 100;

  // The current crop drawn at any width: same transform as the stage, scaled.
  const cropView = (w, className) => {
    const m = w / (fw || 1);
    return (
      <div className={className} style={{ width: w, height: w / ratio }}>
        <img src={url} alt="" draggable={false}
          style={{ width: nat.w * scale * m, height: nat.h * scale * m, transform: `translate(-50%, -50%) translate(${pos.x * m}px, ${pos.y * m}px) rotate(${rot}deg)` }} />
      </div>
    );
  };
  const pvW = 236;
  const k = pvW / PROFILE_W;
  const pu = preview?.user || {};
  const ready = !!(preview && nat && !failed);
  const pvBanner = !ready ? null : preview.kind === 'banner' ? cropView(pvW, 'ie-pv-banner')
    : pu.cover ? <div className="ie-pv-banner" style={{ width: pvW, height: pvW / 3 }}><img className="still" src={pu.cover} alt="" /></div> : null;
  const pvAva = !ready ? null : preview.kind === 'avatar' ? cropView(PROFILE_AVATAR * k, 'ie-pv-ava')
    : <div className="ie-pv-ava" style={{ width: PROFILE_AVATAR * k, height: PROFILE_AVATAR * k }}>{pu.avatar ? <img className="still" src={pu.avatar} alt="" /> : <Icon name="user" size={30} />}</div>;
  return createPortal(
    <div className="ie" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ie-head">
        <button className="ie-text" onClick={onCancel}>Cancel</button>
        <b>{title}</b>
        <button className="ie-text primary" disabled={busy || !nat || failed} onClick={done}>{busy ? 'Saving…' : doneLabel}</button>
      </div>

      <div ref={stage} className={`ie-stage ${dragging ? 'dragging' : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
        {url && !failed && (
          <img ref={imgRef} src={url} alt="" draggable={false} onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} onError={() => setFailed(true)}
            style={nat ? { width: nat.w * scale, height: nat.h * scale, transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) rotate(${rot}deg)` } : { opacity: 0 }} />
        )}
        {nat && !failed && (
          <div className={`ie-frame ${round ? 'round' : ''}`} style={{ width: fw, height: fh }}>
            <span className="ie-grid" />
            {preview?.kind === 'banner' && (
              <span className="ie-ava-mark" title="Your profile photo covers this part"
                style={{ left: `${(PROFILE_INSET / PROFILE_W) * 100}%`, width: `${(PROFILE_AVATAR / PROFILE_W) * 100}%`, backgroundImage: pu.avatar ? `url(${pu.avatar})` : undefined }} />
            )}
          </div>
        )}
        {failed && (
          <div className="ie-failed">
            <Icon name="image" size={28} />
            <p>This photo can't be edited here.</p>
            <button className="btn sm" onClick={() => onDone(file)}>Use it as is</button>
          </div>
        )}
      </div>

      {ready && (
        <div className="ie-pv">
          <div className="ie-pv-label"><Icon name="eye" size={13} /> How others see your profile</div>
          <div className="ie-pv-card" style={{ width: pvW }}>
            {pvBanner}
            <div className="ie-pv-top" style={pvBanner ? { marginTop: -(PROFILE_AVATAR * k) / 2, paddingLeft: PROFILE_INSET * k } : undefined}>{pvAva}</div>
            <b>{pu.full_name || 'Your name'}</b>
            {pu.username && <small>@{pu.username}</small>}
          </div>
        </div>
      )}

      <div className="ie-tools">
        <div className="ie-zoom">
          <button className="icon-btn" onClick={() => setZoomTo(zoom - 0.25)} aria-label="Zoom out"><Icon name="minus" size={18} /></button>
          <input type="range" min="1" max={MAX_ZOOM} step="0.01" value={zoom} onChange={(e) => setZoomTo(Number(e.target.value))} aria-label="Zoom" style={{ '--p': `${zoomPct}%` }} />
          <button className="icon-btn" onClick={() => setZoomTo(zoom + 0.25)} aria-label="Zoom in"><Icon name="plus" size={18} /></button>
        </div>
        {aspects.length > 1 && (
          <div className="ie-row" role="group" aria-label="Crop shape">
            {aspects.map((a) => (
              <button key={a.label} className={`ie-chip ${aspect === a.value ? 'on' : ''}`} onClick={() => pickAspect(a.value)} aria-pressed={aspect === a.value}>
                <i style={a.value === 'original' ? undefined : { aspectRatio: a.value }} className={a.value === 'original' ? 'orig' : ''} />{a.label}
              </button>
            ))}
          </div>
        )}
        <div className="ie-row">
          <button className="ie-tool" onClick={rotate}><Icon name="rotate" size={20} /><span>Rotate</span></button>
          <button className="ie-tool" onClick={() => { setRot(0); reset(); }} disabled={!rot && zoom === 1 && !off.x && !off.y}><Icon name="refresh" size={20} /><span>Reset</span></button>
        </div>
        <p className="ie-hint">Drag to move · pinch or scroll to zoom</p>
      </div>
    </div>,
    document.body,
  );
}

/** Edit button support for a list of picked photos: returns [onEdit, editorElement]. */
export function usePhotoEditing(files, setFiles, options = {}) {
  const [editing, setEditing] = useState(null);
  const el = editing != null && files[editing] ? (
    <ImageEditor file={files[editing]} aspects={POST_ASPECTS} title={files.length > 1 ? `Edit photo ${editing + 1} of ${files.length}` : 'Edit photo'} {...options}
      onCancel={() => setEditing(null)}
      onDone={(f) => { setFiles(files.map((x, j) => (j === editing ? f : x))); setEditing(null); }} />
  ) : null;
  return [setEditing, el];
}
