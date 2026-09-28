/* ===========================================================================
   ubus JSON-RPC client for Q11 Freedom
   The router exposes /ubus (uhttpd ubus_prefix). We authenticate via
   session.login -> ubus_rpc_session token, then call objects/methods.
   =========================================================================== */

const NULL_SESSION = '00000000000000000000000000000000';
const STORAGE_KEY = 'freedom.session';

// In dev we proxy /ubus to the router via Vite; in prod the SPA is served
// from the router itself, so a relative path works in both cases.
const UBUS_URL = '/ubus';

export type UbusResult<T = unknown> = [number, T];

export class UbusError extends Error {
  code: number;
  constructor(code: number, msg: string) {
    super(msg);
    this.code = code;
    this.name = 'UbusError';
  }
}

let sessionId: string = sessionStorage.getItem(STORAGE_KEY) || NULL_SESSION;

export function getSession(): string {
  return sessionId;
}

export function isAuthenticated(): boolean {
  return sessionId !== NULL_SESSION;
}

function setSession(id: string) {
  sessionId = id;
  if (id === NULL_SESSION) sessionStorage.removeItem(STORAGE_KEY);
  else sessionStorage.setItem(STORAGE_KEY, id);
}

/* Session-lost hook: the auth layer registers a handler so any 401 / ubus
   status 6 — from ubus or from the CGI — sends the user back to the login. */
let onLost: (() => void) | null = null;
export function onSessionLost(fn: (() => void) | null) { onLost = fn; }
export function notifySessionLost() {
  const was = isAuthenticated();
  setSession(NULL_SESSION);
  if (was) onLost?.();
}

let reqId = 1;

/** Low-level JSON-RPC envelope call. */
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(UBUS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: reqId++, method, params }),
  });
  if (!res.ok) throw new UbusError(-1, `HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new UbusError(json.error.code ?? -1, json.error.message ?? 'rpc error');
  return json.result as T;
}

/**
 * Call a ubus object's method. Returns the payload (second element of the
 * [status, data] tuple). Throws UbusError on non-zero ubus status.
 * Status 6 = access denied / session expired.
 */
export async function call<T = any>(
  object: string,
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await rpc<UbusResult<T>>('call', [sessionId, object, method, args]);
  if (!Array.isArray(result)) throw new UbusError(-1, 'malformed ubus response');
  const [status, data] = result;
  if (status !== 0) {
    if (status === 6) {
      notifySessionLost();
      throw new UbusError(6, 'session expired');
    }
    throw new UbusError(status, `ubus status ${status} on ${object}.${method}`);
  }
  return data as T;
}

export interface LoginInfo {
  ubus_rpc_session: string;
  timeout: number;
  expires: number;
  acls: Record<string, unknown>;
}

/** Authenticate with root credentials; stores the session token. */
export async function login(username: string, password: string): Promise<LoginInfo> {
  const result = await rpc<UbusResult<LoginInfo>>('call', [
    NULL_SESSION,
    'session',
    'login',
    { username, password },
  ]);
  const [status, data] = result;
  if (status !== 0 || !data?.ubus_rpc_session) {
    throw new UbusError(status, 'Invalid credentials');
  }
  setSession(data.ubus_rpc_session);
  return data;
}

export function logout() {
  // No server-side `session destroy`: on this firmware it is ACL-denied (so it
  // never invalidated anything) and it leaves uhttpd's keep-alive connection
  // stuck, delaying the next request — the re-login — by ~20 s. The token is
  // dropped here and expires server-side after 300 s without use.
  setSession(NULL_SESSION);
}

/** Keep the session alive (call periodically). */
export async function touchSession(): Promise<boolean> {
  if (!isAuthenticated()) return false;
  try {
    await call('session', 'access', { scope: 'ubus', object: 'session', function: 'access' });
    return true;
  } catch {
    return false;
  }
}
