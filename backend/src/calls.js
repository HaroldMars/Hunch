import crypto from 'node:crypto';
import { get } from './db.js';

// Voice and video calls for personal, group and team chats: peer-to-peer WebRTC (each person connects to
// each other person, up to MAX_PEOPLE), with this server only relaying the connection setup over sockets.
// Calls live in memory; the chat gets a short system message when a call starts and ends.
const MAX_PEOPLE = 8;
const RING_MS = 45_000;
const calls = new Map(); // callId -> call

const isMember = (cid, uid) => !!get('SELECT 1 x FROM conversation_members WHERE conversation_id = ? AND user_id = ?', cid, uid);
const publicCall = (c) => ({ id: c.id, conversationId: c.conversationId, kind: c.kind, startedBy: c.startedBy, participants: [...c.participants], startedAt: c.startedAt, answeredAt: c.answeredAt });
const fmtDuration = (ms) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

export function registerCalls(io, socket, { memberIds, postMessage, publicUser }) {
  const uid = socket.userId;
  const toUser = (id, ev, data) => io.to(`user:${id}`).emit(ev, data);
  const label = (c) => (c.kind === 'video' ? 'video call' : 'voice call');
  const system = (c, text) => { try { postMessage({ conversationId: c.conversationId, sender: { id: c.startedBy }, text, kind: 'system' }); } catch { /* chat gone */ } };

  function end(c, reason = 'ended') {
    if (!calls.has(c.id)) return;
    calls.delete(c.id);
    clearTimeout(c.ringTimer);
    memberIds(c.conversationId).forEach((id) => toUser(id, 'call:ended', { callId: c.id, reason }));
    const who = publicUser(c.startedBy)?.full_name?.split(' ')[0] || 'Someone';
    system(c, c.answeredAt ? `${c.kind === 'video' ? '📹' : '📞'} ${label(c)[0].toUpperCase()}${label(c).slice(1)} · ${fmtDuration(Date.now() - c.answeredAt)}` : `📵 Missed ${label(c)} from ${who}`);
  }
  function leave(c) {
    if (!c.participants.delete(uid)) return;
    c.participants.forEach((id) => toUser(id, 'call:peer-left', { callId: c.id, userId: uid }));
    toUser(uid, 'call:left', { callId: c.id });
    // A call ends when fewer than two people are left in it (or nobody answered yet).
    if (c.participants.size < 2 && (c.answeredAt || c.participants.size === 0)) end(c);
  }
  const callFor = (callId) => {
    const c = calls.get(String(callId));
    return c && isMember(c.conversationId, uid) ? c : null;
  };

  socket.on('call:start', ({ conversationId, kind } = {}, ack = () => {}) => {
    const cid = Number(conversationId);
    if (!isMember(cid, uid)) return ack({ error: 'You are not in this chat.' });
    const conv = get('SELECT type FROM conversations WHERE id = ?', cid);
    if (conv?.type === 'direct') {
      const other = memberIds(cid).find((id) => id !== uid);
      if (!other || get('SELECT 1 x FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)', uid, other, other, uid)) return ack({ error: 'You can’t call this person.' });
    }
    // Joining a call that's already going in this chat.
    const existing = [...calls.values()].find((c) => c.conversationId === cid);
    if (existing) return join(existing, ack);
    const c = { id: crypto.randomUUID(), conversationId: cid, kind: kind === 'video' ? 'video' : 'audio', startedBy: uid, participants: new Set([uid]), startedAt: Date.now(), answeredAt: null };
    calls.set(c.id, c);
    const from = publicUser(uid);
    memberIds(cid).filter((id) => id !== uid).forEach((id) => toUser(id, 'call:ring', { call: publicCall(c), from }));
    c.ringTimer = setTimeout(() => { if (!c.answeredAt) end(c, 'missed'); }, RING_MS);
    ack({ call: publicCall(c) });
  });

  function join(c, ack) {
    if (c.participants.has(uid)) return ack({ call: publicCall(c) });
    if (c.participants.size >= MAX_PEOPLE) return ack({ error: `Calls are limited to ${MAX_PEOPLE} people.` });
    // People already in the call start the connection to the newcomer.
    c.participants.forEach((id) => toUser(id, 'call:peer-joined', { callId: c.id, user: publicUser(uid) }));
    c.participants.add(uid);
    if (!c.answeredAt) { c.answeredAt = Date.now(); clearTimeout(c.ringTimer); }
    // Your other devices stop ringing.
    toUser(uid, 'call:answered-elsewhere', { callId: c.id, socketId: socket.id });
    ack({ call: publicCall(c), peers: [...c.participants].filter((id) => id !== uid).map(publicUser) });
  }
  socket.on('call:join', ({ callId } = {}, ack = () => {}) => {
    const c = callFor(callId);
    if (!c) return ack({ error: 'This call has ended.' });
    join(c, ack);
  });
  socket.on('call:decline', ({ callId } = {}) => {
    const c = callFor(callId);
    if (!c) return;
    c.participants.forEach((id) => toUser(id, 'call:declined', { callId: c.id, userId: uid }));
    toUser(uid, 'call:answered-elsewhere', { callId: c.id });
    // Personal chats: a decline ends the call.
    if (!c.answeredAt && get('SELECT type FROM conversations WHERE id = ?', c.conversationId)?.type === 'direct') end(c, 'declined');
  });
  socket.on('call:leave', ({ callId } = {}) => { const c = callFor(callId); if (c) leave(c); });
  socket.on('call:signal', ({ callId, to, data } = {}) => {
    const c = callFor(callId);
    if (!c || !c.participants.has(uid) || !c.participants.has(Number(to))) return;
    toUser(Number(to), 'call:signal', { callId: c.id, from: uid, data });
  });
  socket.on('call:media', ({ callId, audio, video } = {}) => {
    const c = callFor(callId);
    if (c) c.participants.forEach((id) => id !== uid && toUser(id, 'call:media', { callId: c.id, userId: uid, audio: !!audio, video: !!video }));
  });
  socket.on('disconnect', () => {
    // Leave calls only when this was the socket in the call (another tab may still be connected).
    const stillOnline = [...io.sockets.sockets.values()].some((s) => s.userId === uid && s.id !== socket.id);
    if (!stillOnline) [...calls.values()].filter((c) => c.participants.has(uid)).forEach(leave);
  });
}
