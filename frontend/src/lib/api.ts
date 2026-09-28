/* ===========================================================================
   Domain API for Q11 Freedom — typed wrappers over ubus calls.
   Shapes verified against the live router (OpenWrt 2.0.1.390 / BCM947622).
   =========================================================================== */
import { call } from './ubus';
import { getMeshClients, getHostNames, type Station } from './meshApi';

/* ----- System ----------------------------------------------------------- */
export interface BoardInfo {
  kernel: string;
  hostname: string;
  system: string;
  model: string;
  board_name: string;
  release: {
    distribution: string;
    version: string;
    target: string;
    description: string;
  };
}

export interface SystemInfo {
  localtime: number;
  uptime: number;
  load: [number, number, number]; // /65536.0 for real load avg
  memory: {
    total: number;
    free: number;
    available: number;
    buffered: number;
    cached: number;
    shared: number;
  };
}

export const getBoard = () => call<BoardInfo>('system', 'board');
export const getSystemInfo = () => call<SystemInfo>('system', 'info');

/* ----- DHCP leases / devices -------------------------------------------- */
export interface DhcpLease {
  expires: number;
  hostname: string;
  macaddr: string;
  ipaddr: string;
  duid?: string;
}

export async function getDhcpLeases(): Promise<DhcpLease[]> {
  const r = await call<{ dhcp_leases: DhcpLease[] }>('luci-rpc', 'getDHCPLeases');
  return (r?.dhcp_leases ?? []).map((l) => ({
    ...l,
    hostname: l.hostname && l.hostname !== '*' ? l.hostname : '',   // '' = the device sent no name
    macaddr: (l.macaddr || '').toUpperCase(),
  }));
}

/* ----- Devices-by-node (the centerpiece) -------------------------------- */
export interface ConnectedDevice {
  mac: string;
  hostname: string;   // DHCP hostname ('' = unknown); pretty name/type come from lib/deviceId
  nameSource: 'dhcp' | 'saved' | null; // current lease, or remembered by the router (survives reboots)
  leased: boolean;    // has a current DHCP lease
  ipaddr: string;
  nodeId: string | null; // which physical node it is associated to
  conn: 'wifi' | 'cable' | null;   // connection type (null = unknown/offline)
  band: '2.4G' | '5G' | 'cable' | null;
  signal: number | null; // dBm (null for wired)
  expires: number;
}

/**
 * How much we trust a station report when the same MAC shows up on several
 * nodes (docs/API.md): WiFi > cable seen by a slave > cable seen by the master.
 * The master sees every wired client of a slave through the backhaul cable.
 */
function stationRank(st: Station): number {
  if (st.conn === 'wifi') return 3;
  return st.node && st.node !== 'master' ? 2 : 1;
}

/**
 * Cross-references DHCP leases (central, on master) with the client list of
 * the whole mesh (`mesh_clients`, aggregated server-side from every node).
 */
export async function getDevicesByNode(): Promise<ConnectedDevice[]> {
  const [leases, stations, saved] = await Promise.all([
    getDhcpLeases(),
    getMeshClients().catch(() => [] as Station[]),
    getHostNames().catch(() => ({} as Record<string, string>)),
  ]);
  // name from the lease; else the one the router remembered from an earlier lease
  const nameOf = (mac: string, leaseName = ''): Pick<ConnectedDevice, 'hostname' | 'nameSource'> =>
    leaseName ? { hostname: leaseName, nameSource: 'dhcp' }
      : saved[mac] ? { hostname: saved[mac], nameSource: 'saved' }
      : { hostname: '', nameSource: null };

  // Build MAC -> {nodeId, conn, band, signal}; on WiFi ties keep the strongest.
  const assocMap = new Map<string, { nodeId: string; conn: 'wifi' | 'cable'; band: '2.4G' | '5G' | 'cable'; signal: number | null; rank: number }>();
  for (const st of stations) {
    const prev = assocMap.get(st.mac);
    const rank = stationRank(st);
    if (!prev || rank > prev.rank ||
        (rank === 3 && prev.rank === 3 && (st.signal ?? -999) > (prev.signal ?? -999))) {
      assocMap.set(st.mac, { nodeId: st.node || 'master', conn: st.conn, band: st.band, signal: st.signal, rank });
    }
  }

  const fromLeases: ConnectedDevice[] = leases.map((l) => {
    const a = assocMap.get(l.macaddr);
    return {
      mac: l.macaddr,
      ...nameOf(l.macaddr, l.hostname),
      leased: true,
      ipaddr: l.ipaddr,
      nodeId: a?.nodeId ?? null,
      conn: a?.conn ?? null,
      band: a?.band ?? null,
      signal: a?.signal ?? null,
      expires: l.expires,
    };
  });

  // Connected clients WITHOUT a DHCP lease. The lease table lives in RAM and is
  // lost on reboot; a device that kept its IP (e.g. a wired PC) never asks
  // again, so it is connected but invisible in the leases. Show it anyway,
  // with the IP the router sees in its ARP table.
  const leased = new Set(leases.map((l) => l.macaddr));
  const ipByMac = new Map(stations.filter((s) => s.ip).map((s) => [s.mac, s.ip as string]));
  const unleased: ConnectedDevice[] = [...assocMap.entries()]
    .filter(([mac]) => !leased.has(mac))
    .map(([mac, a]) => ({
      mac,
      ...nameOf(mac),
      leased: false,
      ipaddr: ipByMac.get(mac) ?? '—',
      nodeId: a.nodeId,
      conn: a.conn,
      band: a.band,
      signal: a.signal,
      expires: 0,
    }));

  return [...fromLeases, ...unleased];
}

/**
 * Connected clients per node, split by WiFi / cable. `nodes` only reports WiFi
 * (`clients`), so the wired ones come from the mesh-wide client list. MACs of
 * the mesh nodes themselves (a slave is a wired client of the master) are left out.
 */
export function clientsByNode(devices: ConnectedDevice[], nodeMacs: string[]) {
  const skip = new Set(nodeMacs.map((m) => m.toUpperCase()));
  const out: Record<string, { wifi: number; cable: number }> = {};
  for (const d of devices) {
    if (!d.nodeId || !d.conn || skip.has(d.mac)) continue;
    const c = (out[d.nodeId] ??= { wifi: 0, cable: 0 });
    c[d.conn]++;
  }
  return out;
}
