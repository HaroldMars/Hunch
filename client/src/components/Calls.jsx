import { useEffect, useRef, useState } from 'react';
import Icon from '@shared/Icon.jsx';
import { api } from '../api.js';
import { useApp, useSocket } from '../store.jsx';
import { Avatar } from './ui.jsx';

// Voice and video calls (personal, group and team chats). Peer-to-peer WebRTC: everyone in the call
// connects to everyone else; the server relays offers, answers and network candidates over the socket.
let starter = null;
/** Start (or join) a call in a chat. `kind` is 'audio' or 'video'. */
export const startCall = (conversationId, kind, meta) => starter?.(conversationId, kind, meta);

let iceCache = [{ urls: 'stun:stun.l.google.com:19302' }];
const loadIce = () => api('/calls/ice').then((r) => { iceCache = r.iceServers; }).catch(() => {});
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function Tile({ peer, mirrored, muted }) {
  const ref = useRef();
  useEffect(() => { if (ref.current && peer.stream && ref.current.srcObject !== peer.stream) ref.current.srcObject = peer.stream; }, [peer.stream]);
  const showVideo = peer.stream && peer.video !== false && peer.stream.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled !== false);
  return (
    <div className={`call-tile ${showVideo ? 'has-video' : ''}`}>
      <video ref={ref} autoPlay playsInline muted={muted} className={mirrored ? 'mirror' : ''} style={{ display: showVideo ? 'block' : 'none' }} />
      {!showVideo && <div className="ct-ava"><Avatar user={peer.user} size={84} /></div>}
      <div className="ct-name">{peer.user?.full_name?.split(' ')[0]}{peer.audio === false && <Icon name="micOff" size={13} />}</div>
      {peer.state && peer.state !== 'connected' && <div className="ct-state">{peer.state === 'connecting' || peer.state === 'new' ? 'Connecting…' : peer.state}</div>}
    </div>
  );
}

export default function CallLayer() {
  const { user, emit, toast } = useApp();
  const [incoming, setIncoming] = useState(null); // { call, from }
  const [call, setCall] = useState(null); // { id, conversationId, kind, title, status }
  const [peers, setPeers] = useState({}); // userId -> { user, stream, state, audio, video }
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [secs, setSecs] = useState(0);
  const local = useRef(null);
  const pcs = useRef(new Map());
  const callRef = useRef(null);
  const localVideo = useRef();
  callRef.current = call;
  const ringtone = useRef(null);

  const patchPeer = (id, p) => setPeers((all) => ({ ...all, [id]: { ...(all[id] || {}), ...p } }));
  const cleanup = () => {
    pcs.current.forEach((pc) => pc.close());
    pcs.current.clear();
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    setPeers({}); setCall(null); setSecs(0); setMic(true); setCam(true);
  };
  const getMedia = async (kind) => {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false });
    } catch (e) {
      toast(kind === 'video' ? 'Allow camera and microphone access to make a video call.' : 'Allow microphone access to make a call.', 'error');
      throw e;
    }
  };
  // One connection per other person in the call. Network candidates that arrive early wait for the description.
  const connect = (peer) => {
    const c = callRef.current;
    if (pcs.current.has(peer.id)) return pcs.current.get(peer.id);
    const pc = new RTCPeerConnection({ iceServers: iceCache });
    pc.pending = [];
    pcs.current.set(peer.id, pc);
    patchPeer(peer.id, { user: peer, state: 'connecting' });
    local.current?.getTracks().forEach((t) => pc.addTrack(t, local.current));
    pc.onicecandidate = (e) => e.candidate && emit('call:signal', { callId: c.id, to: peer.id, data: { candidate: e.candidate } });
    pc.ontrack = (e) => patchPeer(peer.id, { stream: e.streams[0] });
    pc.onconnectionstatechange = () => patchPeer(peer.id, { state: pc.connectionState });
    return pc;
  };

  useEffect(() => { loadIce(); }, []);
  useEffect(() => {
    starter = async (conversationId, kind, meta = {}) => {
      if (callRef.current) return toast('You’re already in a call.', 'error');
      let stream;
      try { stream = await getMedia(kind); } catch { return; }
      local.current = stream;
      emit('call:start', { conversationId, kind }, (r) => {
        if (r?.error) { stream.getTracks().forEach((t) => t.stop()); local.current = null; return toast(r.error, 'error'); }
        setCall({ ...r.call, title: meta.title, avatar: meta.avatar, status: r.call.participants.length > 1 ? 'live' : 'ringing' });
        setCam(kind === 'video');
      });
    };
    return () => { starter = null; };
  }, [emit]);

  useEffect(() => { if (localVideo.current && local.current) localVideo.current.srcObject = local.current; });
  useEffect(() => {
    if (!call || call.status !== 'live') return undefined;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [call?.status]);
  // Soft ring for incoming calls (where the browser allows sound).
  useEffect(() => {
    if (!incoming) return undefined;
    let ctx; let timer;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const beep = () => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = 520; g.gain.value = 0.05; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.35); };
      beep(); timer = setInterval(beep, 1600);
    } catch { /* no audio */ }
    ringtone.current = ctx;
    return () => { clearInterval(timer); ctx?.close?.().catch(() => {}); };
  }, [incoming?.call?.id]);

  useSocket('call:ring', ({ call: c, from }) => { if (!callRef.current && from.id !== user.id) setIncoming({ call: c, from }); });
  useSocket('call:answered-elsewhere', ({ callId }) => setIncoming((i) => (i?.call.id === callId ? null : i)));
  useSocket('call:ended', ({ callId, reason }) => {
    setIncoming((i) => (i?.call.id === callId ? null : i));
    if (callRef.current?.id === callId) { if (reason === 'declined') toast('Call declined'); else if (reason === 'missed') toast('No answer'); cleanup(); }
  });
  useSocket('call:left', ({ callId }) => { if (callRef.current?.id === callId) cleanup(); });
  useSocket('call:declined', ({ callId, userId }) => { if (callRef.current?.id === callId && userId !== user.id) toast('Someone declined the call'); });
  useSocket('call:peer-joined', async ({ callId, user: peer }) => {
    if (callRef.current?.id !== callId) return;
    setCall((c) => ({ ...c, status: 'live' }));
    const pc = connect(peer);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    emit('call:signal', { callId, to: peer.id, data: { sdp: pc.localDescription } });
  });
  useSocket('call:peer-left', ({ callId, userId }) => {
    if (callRef.current?.id !== callId) return;
    pcs.current.get(userId)?.close();
    pcs.current.delete(userId);
    setPeers((all) => { const n = { ...all }; delete n[userId]; return n; });
  });
  useSocket('call:media', ({ callId, userId, audio, video }) => { if (callRef.current?.id === callId) patchPeer(userId, { audio, video }); });
  useSocket('call:signal', async ({ callId, from, data }) => {
    if (callRef.current?.id !== callId) return;
    const pc = pcs.current.get(from) || connect(peers[from]?.user || { id: from });
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        for (const cand of pc.pending.splice(0)) await pc.addIceCandidate(cand).catch(() => {});
        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          emit('call:signal', { callId, to: from, data: { sdp: pc.localDescription } });
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
        else pc.pending.push(data.candidate);
      }
    } catch { /* a late candidate after hang-up */ }
  });

  const accept = async () => {
    const { call: c, from } = incoming;
    setIncoming(null);
    let stream;
    try { stream = await getMedia(c.kind); } catch { emit('call:decline', { callId: c.id }); return; }
    local.current = stream;
    setCall({ ...c, title: from.full_name, avatar: from.avatar, status: 'live' });
    setCam(c.kind === 'video');
    emit('call:join', { callId: c.id }, (r) => {
      if (r?.error) { toast(r.error, 'error'); cleanup(); return; }
      // Who's already here: they send us their offers.
      (r.peers || []).forEach((p) => patchPeer(p.id, { user: p, state: 'connecting' }));
    });
  };
  const decline = () => { emit('call:decline', { callId: incoming.call.id }); setIncoming(null); };
  const hangUp = () => { emit('call:leave', { callId: call.id }); cleanup(); };
  const toggleMic = () => { const on = !mic; local.current?.getAudioTracks().forEach((t) => { t.enabled = on; }); setMic(on); emit('call:media', { callId: call.id, audio: on, video: cam }); };
  const toggleCam = async () => {
    const on = !cam;
    let track = local.current?.getVideoTracks()[0];
    if (on && !track) {
      // Turning the camera on during a voice call.
      try {
        const v = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        track = v.getVideoTracks()[0];
        local.current.addTrack(track);
        for (const [pid, pc] of pcs.current) {
          pc.addTrack(track, local.current);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          emit('call:signal', { callId: call.id, to: pid, data: { sdp: pc.localDescription } });
        }
      } catch { return toast('Allow camera access to turn on video.', 'error'); }
    }
    if (track) track.enabled = on;
    setCam(on);
    emit('call:media', { callId: call.id, audio: mic, video: on });
  };

  if (incoming) {
    const { call: c, from } = incoming;
    return (
      <div className="call-screen ringing" role="dialog" aria-label="Incoming call">
        <div className="cs-bg" style={from.avatar ? { backgroundImage: `url(${from.avatar})` } : undefined} />
        <div className="cs-center">
          <div className="cs-pulse"><Avatar user={from} size={112} /></div>
          <h2>{from.full_name}</h2>
          <p>Incoming {c.kind === 'video' ? 'video' : 'voice'} call…</p>
        </div>
        <div className="cs-controls">
          <button className="cs-btn end" onClick={decline} aria-label="Decline"><Icon name="close" size={28} /></button>
          <button className="cs-btn accept" onClick={accept} aria-label="Accept"><Icon name={c.kind === 'video' ? 'video' : 'phone'} size={28} /></button>
        </div>
      </div>
    );
  }
  if (!call) return null;
  const list = Object.entries(peers).map(([id, p]) => ({ id: Number(id), ...p })).filter((p) => p.user);

  return (
    <div className={`call-screen ${call.kind} n${Math.min(list.length, 4)}`} role="dialog" aria-label="Call">
      <div className="cs-bg" style={call.avatar ? { backgroundImage: `url(${call.avatar})` } : undefined} />
      <div className="cs-top">
        <b>{call.title || 'Call'}</b>
        <span>{call.status === 'ringing' && !list.length ? 'Calling…' : call.status === 'live' ? fmt(secs) : 'Connecting…'} · {call.kind === 'video' ? 'Video' : 'Voice'}{list.length > 1 ? ` · ${list.length + 1} people` : ''}</span>
      </div>
      {!list.length ? (
        <div className="cs-center"><div className="cs-pulse"><Avatar src={call.avatar} user={call.avatar ? undefined : user} size={112} /></div><p>{call.status === 'ringing' ? 'Ringing…' : 'Waiting for others…'}</p></div>
      ) : (
        <div className="call-grid">{list.map((p) => <Tile key={p.id} peer={p} />)}</div>
      )}
      {(cam && local.current?.getVideoTracks().length > 0) && (
        <div className="call-self"><video ref={localVideo} autoPlay playsInline muted className="mirror" /></div>
      )}

      <div className="cs-controls">
        <button className={`cs-btn ${mic ? '' : 'off'}`} onClick={toggleMic} aria-label={mic ? 'Mute' : 'Unmute'} aria-pressed={!mic}><Icon name={mic ? 'mic' : 'micOff'} size={24} /></button>
        <button className={`cs-btn ${cam ? '' : 'off'}`} onClick={toggleCam} aria-label={cam ? 'Turn camera off' : 'Turn camera on'} aria-pressed={!cam}><Icon name="video" size={24} /></button>
        <button className="cs-btn end" onClick={hangUp} aria-label="End call"><Icon name="phone" size={26} style={{ transform: 'rotate(135deg)' }} /></button>
      </div>
    </div>
  );
}
