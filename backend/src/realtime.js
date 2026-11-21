let io = null;
const online = new Map(); // userId -> socket count
export const setIO = (i) => (io = i);
export const getIO = () => io;
export const emitToUser = (userId, event, data) => io?.to(`user:${userId}`).emit(event, data);
export const emitToUsers = (ids, event, data) => ids.forEach((id) => emitToUser(id, event, data));
export const markOnline = (id, delta) => {
  const n = (online.get(id) || 0) + delta;
  if (n <= 0) online.delete(id);
  else online.set(id, n);
};
export const isOnline = (id) => online.has(id);
