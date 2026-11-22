// Thin fetch wrapper. Token lives in localStorage (per-origin, so client and admin stay separate).
const KEY = 'hunch_token';
// "Remember me" keeps the token in localStorage; otherwise it lives only for this browser session.
export const getToken = () => {
  try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY); } catch { return null; }
};
export const setToken = (t, remember = true) => {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
    if (t) (remember ? localStorage : sessionStorage).setItem(KEY, t);
  } catch { /* storage unavailable */ }
};
// Accept a session handed over from the other Hunch app via the URL hash (#handoff=<token>&r=1).
export function consumeHandoff() {
  const m = /[#&]handoff=([^&]+)(?:&r=(\d))?/.exec(window.location.hash);
  if (!m) return;
  setToken(decodeURIComponent(m[1]), m[2] !== "0");
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}
// Where the sibling app lives (dev: separate Vite ports; prod: served by the API server).
export const CLIENT_URL = (import.meta.env.VITE_CLIENT_URL || "http://localhost:5173").replace(/\/$/, "") + "/";
export const ADMIN_URL = (import.meta.env.VITE_ADMIN_URL || "http://localhost:3000").replace(/\/$/, "") + "/";

// API base: empty in development (Vite proxies /api to the backend), the API domain in production.
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let onAuthIssue = () => {};
export const setAuthIssueHandler = (fn) => (onAuthIssue = fn);

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'Can’t reach the Hunch server. Check your connection and try again.');
  }
  // A non-JSON reply means we reached a web page, not the API (e.g. VITE_API_URL is missing in production).
  if (!(res.headers.get('content-type') || '').includes('application/json') && res.status !== 204) {
    throw new ApiError(res.status || 502, 'Can’t reach the Hunch server right now. Please try again later.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401 || res.status === 428) onAuthIssue(res.status, data?.code);
    throw new ApiError(res.status, data?.error || 'Request failed (' + res.status + ')', data?.code);
  }
  return data;
}

export const toForm = (obj) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.append(k, v);
  }
  return f;
};
