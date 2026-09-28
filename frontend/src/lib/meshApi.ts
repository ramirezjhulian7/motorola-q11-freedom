/* ===========================================================================
   Client for /cgi-bin/freedom-api.sh — the authenticated backend.
   Contract: docs/API.md. Every call sends the current ubus session token;
   the CGI only reads string values, so every param is stringified here.
   =========================================================================== */
import { getSession, notifySessionLost } from './ubus';

const API_URL = '/cgi-bin/freedom-api.sh';

export class MeshApiError extends Error {}

type Params = Record<string, string | number | boolean | undefined | null>;

/** Drops empty values and turns everything else into a string. */
function strParams(p: Params): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
  }
  return out;
}

// The CGI answers a few validation errors with terse codes; expand those.
// Anything else is already a plain English sentence and is shown as-is.
const ERRORS: Record<string, string> = {
  'bad mac': 'Invalid MAC address.',
  'bad ip': 'Invalid IP address.',
  'bad netmask': 'Invalid netmask.',
  'bad range': 'Invalid range.',
  'bad speed': 'Invalid speed.',
  'bad node_id': 'Invalid node.',
  'bad ssid chars': 'The network name cannot contain quotes, \\, $ or `.',
  'ssid too long': 'The network name can be at most 32 characters.',
  'key too short (min 8)': 'The WiFi password needs at least 8 characters.',
  'key too long (max 63)': 'The WiFi password can be at most 63 characters.',
  'bad key chars': 'The WiFi password cannot contain quotes, \\, $ or `.',
  'bad channel': 'Invalid channel.',
  'bad leasetime': 'Invalid lease time.',
  'password too short (min 8)': 'The password needs at least 8 characters.',
  'bad password chars': 'The password cannot contain quotes, \\, $ or `.',
  'passwd failed': 'Could not change the password.',
  'bad proto': 'Invalid connection type.',
};

async function post<T = any>(action: string, params: Params = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: getSession(), action, ...strParams(params) }),
    });
  } catch {
    throw new MeshApiError('No connection to the router.');
  }
  let json: any = {};
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (res.status === 401) {
    notifySessionLost();
    throw new MeshApiError('Session expired, please sign in again.');
  }
  if (!res.ok || !json.ok) {
    const e = String(json.error || `Error ${res.status}`);
    throw new MeshApiError(ERRORS[e] || e);
  }
  return json as T;
}

/* ----- status of the node we talk to ------------------------------------ */
export interface NodeStatus {
  role: 'master' | 'slave';
  node_id: string;
  version: string;
  hostname: string;
  lan_ip: string;
  wan_ip: string;
  wan_proto: string;
  uptime: number;
  clients: number;
  internet: boolean;
  dhcp: boolean;
  ssid: string;
  master_ip: string;
  last_sync: number;
  slaves: number;
  pw_changed: boolean;
  mac: string;
}
export const getStatus = () => post<NodeStatus & { ok: true }>('status');

/* ----- internet provider (looked up by the router, cached 6 h) --------- */
export interface IspInfo {
  public_ip: string;
  asn: number;
  org: string;       // registered name, e.g. "COMCEL S.A."
  isp: string;
  domain: string;    // e.g. "claro.com.co"
  ts: number;        // when the router looked it up
}
export const getIsp = (refresh = false) =>
  post<IspInfo & { ok: true }>('isp', { refresh: refresh ? '1' : undefined });

// Registered names rarely match the brand people know (COMCEL -> Claro).
const ISP_BRANDS: Record<number, string> = {
  26611: 'Claro', 10620: 'Claro', 14080: 'Claro',
  3816: 'Movistar', 19429: 'ETB',
  13489: 'Tigo', 27831: 'Tigo',
  7922: 'Xfinity', 20115: 'Spectrum', 7018: 'AT&T', 701: 'Verizon', 22773: 'Cox',
  5089: 'Virgin Media', 3320: 'Deutsche Telekom', 2856: 'BT', 3215: 'Orange',
  3352: 'Movistar', 8151: 'Telmex',
};

/** Brand name for an ISP: known ASN, else the domain ("une.net.co" -> "Une"), else the org. */
export function ispBrand(i: IspInfo): string {
  if (ISP_BRANDS[i.asn]) return ISP_BRANDS[i.asn];
  const label = i.domain?.split('.')[0];
  if (label) return label.charAt(0).toUpperCase() + label.slice(1);
  return i.isp || i.org || 'Unknown';
}

/** MAC(upper) -> DHCP hostname the router remembered (kept across reboots). */
export const getHostNames = async () =>
  (await post<{ names: Record<string, string> }>('host_names')).names ?? {};

export const getLog = async () => (await post<{ log: string }>('get_log')).log ?? '';

/* ----- mesh (master only) ----------------------------------------------- */
export interface MeshNodeInfo {
  id: string;
  ip: string;
  online: boolean;
  role?: string;
  self?: boolean;
  uptime?: number;
  clients?: number;
  internet?: boolean;
  ssid?: string;
  synced?: boolean;
  version?: string;
  last_sync?: number;
  mac?: string;
}
export const getNodes = async () => (await post<{ nodes: MeshNodeInfo[] }>('nodes')).nodes ?? [];

export interface FoundNode { ip: string; mac: string; }
export const discoverNodes = async () => (await post<{ found: FoundNode[] }>('discover')).found ?? [];

export type SyncResult = 'ok' | 'reboot' | 'offline' | 'error';
export const adoptNode = (ip: string, password: string, name?: string) =>
  post<{ id: string; sync: SyncResult }>('adopt_node', { ip, password, name: name || undefined });

export const removeNode = (nodeId: string) => post('remove_node', { node_id: nodeId });

export interface NodeSync { id: string; result: SyncResult; }
export const SYNC_TEXT: Record<SyncResult, string> = {
  ok: 'synced',
  reboot: 'rebooting to apply the WiFi (~1 min)',
  offline: 'did not respond',
  error: 'rejected the sync',
};
export const syncNodes = async () => (await post<{ results: NodeSync[] }>('sync_nodes')).results ?? [];

export const rebootNode = (nodeId: string) => post('node_reboot', { node_id: nodeId });
export const getNodeLog = async (nodeId: string) =>
  (await post<{ log: string }>('node_log', { node_id: nodeId })).log ?? '';

/* ----- node / device naming -------------------------------------------- */
export const setNodeName = (nodeId: string, name: string) =>
  post('set_node_name', { node_id: nodeId, name });

export const setDeviceName = (mac: string, name: string) =>
  post('set_device_name', { mac, name });

/* ----- read our private config (names, qos, blocks) --------------------- */
export interface FreedomConfig {
  nodeNames: Record<string, string>;        // nodeId -> name
  deviceNames: Record<string, string>;      // MAC(upper) -> name
  qos: Record<string, number>;              // IP -> down_kbit
  blocked: string[];                        // MACs(upper) with internet paused
}

export async function getFreedomConfig(): Promise<FreedomConfig> {
  const r = await post('get_config');
  return parseUci(r.config || '');
}

/** Minimal uci-export parser for our 'freedom' namespace. */
function parseUci(text: string): FreedomConfig {
  const cfg: FreedomConfig = { nodeNames: {}, deviceNames: {}, qos: {}, blocked: [] };
  // The CGI sends literal "\n" sequences and tab indentation; normalize both.
  const lines = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').split('\n');

  let type = '', section = '', name = '', mac = '', ip = '', down = '';
  const flush = () => {
    if (!section) return;
    if (type === 'node' && name && section.startsWith('node_')) cfg.nodeNames[section.slice(5)] = name;
    if (type === 'device' && mac && name) cfg.deviceNames[mac] = name;
    if (type === 'qos' && ip && down) cfg.qos[ip] = parseInt(down, 10) || 0;
    if (type === 'block' && mac) cfg.blocked.push(mac);
  };

  for (const raw of lines) {
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^config\s+(\w+)\s+'([^']+)'/))) {
      flush();
      type = m[1]; section = m[2]; name = ''; mac = ''; ip = ''; down = '';
    } else if ((m = line.match(/^option\s+name\s+'(.*)'$/))) name = m[1];
    else if ((m = line.match(/^option\s+mac\s+'(.*)'$/))) mac = m[1].toUpperCase();
    else if ((m = line.match(/^option\s+ip\s+'(.*)'$/))) ip = m[1];
    else if ((m = line.match(/^option\s+down\s+'(.*)'$/))) down = m[1];
  }
  flush();
  return cfg;
}

/* ----- WiFi -------------------------------------------------------------- */
export interface WifiUpdate {
  device: 'all' | 'wl0' | 'wl1';
  ssid?: string; key?: string; channel?: string;
  reboot?: '0';   // "0" = save without rebooting (batch several calls)
}
export const setWifi = (u: WifiUpdate) =>
  post<{ note: string; sync: NodeSync[] }>('set_wifi', { ...u });

export interface RadioState { device: string; ssid: string; channel: string; live: string; current: string; }
export async function getWifi(): Promise<RadioState[]> {
  const r = await post('get_wifi');
  return r.radios ?? [];
}

/* ----- Network ----------------------------------------------------------- */
export const setLan = (ipaddr: string, netmask: string) =>
  post('set_lan', { ipaddr, netmask });

export type WanUpdate =
  | { proto: 'dhcp' }
  | { proto: 'static'; ipaddr: string; netmask: string; gateway: string; dns: string }
  | { proto: 'pppoe'; username: string; password: string };
export const setWan = (u: WanUpdate) => post('set_wan', { ...u });

export const setDhcp = (start: string, limit: string, leasetime?: string) =>
  post('set_dhcp', { start, limit, leasetime });

/* ----- IP reservations (static DHCP) ------------------------------------ */
export interface StaticLease { mac: string; ip: string; name: string; }
export async function listStatic(): Promise<StaticLease[]> {
  const r = await post<{ leases: StaticLease[] }>('list_static');
  return (r.leases ?? []).map((l) => ({ ...l, mac: l.mac.toUpperCase() }));
}
export const setStatic = (mac: string, ip: string, name?: string) =>
  post<{ note?: string }>('set_static', { mac, ip, name: name || undefined });
export const delStatic = (mac: string) => post('del_static', { mac });

/* ----- QoS speed limit / pause ------------------------------------------ */
/** down_kbit = 0 removes the limit. */
export const setSpeed = (ip: string, downKbit: number) =>
  post('set_speed', { ip, down_kbit: downKbit });

/** Pause (true) or resume internet for a device across the whole mesh. */
export const setBlock = (mac: string, blocked: boolean) =>
  post('set_block', { mac, blocked: blocked ? '1' : '0' });

/* ----- Client list: connection type (cable/wifi) + signal --------------- */
export interface Station {
  mac: string;
  ip?: string;                      // from the router ARP table (may be empty)
  signal: number | null;            // null for wired
  band: '2.4G' | '5G' | 'cable';
  device: string;                   // wl0 / wl1 / eth1
  conn: 'wifi' | 'cable';
  node: string;                     // id of the node that reports it
}
const normStations = (list: Station[] = []) =>
  list.map((s) => ({ ...s, mac: s.mac.toUpperCase(), ip: s.ip || undefined }));

export const getAssoc = async () => normStations((await post('assoclist')).stations);
export const getMeshClients = async () => normStations((await post('mesh_clients')).stations);

/* ----- Power / credentials ---------------------------------------------- */
export const rebootRouter = () => post('reboot');

export const setPassword = (password: string) =>
  post<{ sync: NodeSync[] }>('set_password', { password });

/** Chars the backend rejects in SSID, keys, passwords and names. */
export const BAD_CHARS = /["'`$\\]/;
