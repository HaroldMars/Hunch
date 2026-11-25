import { useState } from 'react';
import Icon from '@shared/Icon.jsx';
import { Sheet } from './ui.jsx';

const KEY = 'hunch_permissions_asked';
const asked = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };
const remember = () => { try { localStorage.setItem(KEY, '1'); } catch { /* storage unavailable */ } };

/**
 * First launch: ask once for camera, microphone and location so Stories open straight into the camera.
 * Browsers have no separate "photo gallery" permission; the gallery opens through the file picker.
 */
export default function PermissionsPrompt() {
  const [open, setOpen] = useState(() => !asked());
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const done = () => { remember(); setOpen(false); };
  const allow = async () => {
    setBusy(true);
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => null);
        s?.getTracks().forEach((t) => t.stop());
      }
      if (navigator.geolocation) await new Promise((res) => navigator.geolocation.getCurrentPosition(res, res, { timeout: 10000 }));
    } finally { setBusy(false); done(); }
  };
  const rows = [
    ['camera', 'Camera', 'Take photos for your stories in one tap.'],
    ['image', 'Photo gallery', 'Pick photos from your album any time.'],
    ['location', 'Location', 'Tag places and put stories on Map Discovery.'],
    ['comment', 'Microphone', 'Ready for voice and video features.'],
  ];
  return (
    <Sheet title="Set up Hunch" onClose={done}
      footer={<><button className="btn block" disabled={busy} onClick={allow}>{busy ? 'Waiting for your browser…' : 'Allow access'}</button>
        <button className="btn ghost block" style={{ marginTop: 8 }} onClick={done}>Not now</button></>}>
      <p className="small muted" style={{ marginTop: 0 }}>Your browser will ask you to confirm each one. You can change them later in your browser settings.</p>
      {rows.map(([i, t, d]) => (
        <div key={t} className="about-row" style={{ alignItems: 'flex-start' }}>
          <Icon name={i} size={20} /><span><b style={{ color: 'var(--text)' }}>{t}</b><br /><small className="muted">{d}</small></span>
        </div>
      ))}
    </Sheet>
  );
}
