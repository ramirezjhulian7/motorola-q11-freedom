/* ===========================================================================
   Demo router core: fictional answers for POST /ubus (JSON-RPC) and
   POST /cgi-bin/freedom-api.sh, shared by the Vite dev plugin
   (mock-router.ts) and the static browser demo (browser-mock.ts).
   Every value is invented: documentation IP ranges (203.0.113.0/24),
   documentation ASN (64500), made-up MACs and hostnames. Login accepts any
   password. Write actions only answer ok; a reboot makes the fake router
   "disappear" for a few seconds so the reboot screen runs.
   =========================================================================== */

const LAN = '192.168.50';
const MASTER = 'master';
const S1 = 'node2';
const S2 = 'node3';
const SSID = 'MyHomeWiFi';
const HOSTNAME = 'Q11-Living-Room';
const VERSION = '1.0.0';

const now = () => Math.floor(Date.now() / 1000);
const BOOT = now() - 1036800;     // "up for 12 days"

const stations = [
  { mac: '3C:22:FB:4A:10:01', ip: `${LAN}.120`, signal: -48, band: '5G', device: 'wl1', conn: 'wifi', node: MASTER },
  { mac: 'A4:C3:F0:22:8B:02', ip: `${LAN}.121`, signal: -55, band: '5G', device: 'wl1', conn: 'wifi', node: S1 },
  { mac: '28:6C:07:51:9E:03', ip: `${LAN}.122`, signal: -62, band: '2.4G', device: 'wl0', conn: 'wifi', node: S2 },
  { mac: 'F0:18:98:7C:33:04', ip: `${LAN}.123`, signal: -51, band: '5G', device: 'wl1', conn: 'wifi', node: MASTER },
  { mac: '00:D8:61:0E:44:05', ip: `${LAN}.124`, signal: null, band: 'cable', device: 'eth1', conn: 'cable', node: MASTER },
  { mac: '2C:AA:8E:19:55:06', ip: `${LAN}.125`, signal: -67, band: '2.4G', device: 'wl0', conn: 'wifi', node: S1 },
  { mac: '5C:AF:06:3D:66:07', ip: `${LAN}.126`, signal: -58, band: '5G', device: 'wl1', conn: 'wifi', node: S2 },
  { mac: '00:24:BE:6E:77:08', ip: `${LAN}.127`, signal: null, band: 'cable', device: 'eth1', conn: 'cable', node: S1 },
  { mac: '70:EE:50:11:88:09', ip: `${LAN}.128`, signal: -71, band: '2.4G', device: 'wl0', conn: 'wifi', node: S2 },
  { mac: '9C:8E:CD:2B:99:0A', ip: `${LAN}.129`, signal: -45, band: '5G', device: 'wl1', conn: 'wifi', node: MASTER },
  { mac: 'DC:A6:32:4C:AA:0B', ip: `${LAN}.130`, signal: null, band: 'cable', device: 'eth1', conn: 'cable', node: MASTER },
];
const hosts = ['Pixel-9', 'Galaxy-S24', 'HL_CAM3', 'MacBook-Air', 'DESKTOP-4K7QW2E', 'amazon-5b1e9c',
  'LG-webOS-TV', 'PS5', 'Nest-Thermostat', 'iPad', 'raspberrypi'];

const leases = () => stations.map((s, i) => ({
  expires: 30000 + i * 900, hostname: hosts[i], macaddr: s.mac, ipaddr: s.ip,
}));

const nodes = () => [
  { id: MASTER, ip: `${LAN}.1`, role: 'master', self: true, online: true, uptime: now() - BOOT, clients: 4,
    internet: true, ssid: SSID, synced: true, version: VERSION, mac: 'aa:bb:cc:00:00:01' },
  { id: S1, ip: `${LAN}.2`, role: 'slave', online: true, uptime: now() - BOOT - 7200, clients: 2,
    internet: true, ssid: SSID, synced: true, version: VERSION, last_sync: now() - 600, mac: 'aa:bb:cc:00:00:11' },
  { id: S2, ip: `${LAN}.3`, role: 'slave', online: true, uptime: now() - BOOT - 43200, clients: 3,
    internet: true, ssid: SSID, synced: true, version: VERSION, last_sync: now() - 600, mac: 'aa:bb:cc:00:00:21' },
];

// Same shape as `uci export freedom` sent by the CGI (literal "\n" sequences).
const config = [
  "config node 'node'", "\toption role 'master'", "\toption pw_changed '1'",
  `config node 'node_${MASTER}'`, "\toption name 'Living room'",
  `config node 'node_${S1}'`, "\toption name 'Office'", `\toption ip '${LAN}.2'`,
  `config node 'node_${S2}'`, "\toption name 'Upstairs'", `\toption ip '${LAN}.3'`,
  "config device 'dev_F0_18_98_7C_33_04'", "\toption mac 'F0:18:98:7C:33:04'", "\toption name 'Work laptop'",
  `config qos 'qos_${LAN.replace(/\./g, '_')}_127'`, `\toption ip '${LAN}.127'`, "\toption down '20000'",
].join('\\n');

const log = (node: string) => [
  `daemon.info procd: - init complete -`,
  `daemon.notice netifd: Interface 'wan' is now up`,
  `user.notice freedom-role: ${node}: role ${node === MASTER ? 'master' : 'slave'}`,
  `daemon.info dnsmasq-dhcp[2211]: DHCPACK(br-lan) ${LAN}.120 3c:22:fb:4a:10:01 Pixel-9`,
  `user.notice freedom-api: sync ok`,
  `daemon.info dnsmasq-dhcp[2211]: DHCPACK(br-lan) ${LAN}.123 f0:18:98:7c:33:04 MacBook-Air`,
].map((l, i) => `Sun Sep 27 10:${String(i * 7).padStart(2, '0')}:00 2026 ${l}`).join('\n');

const okSync = () => [{ id: S1, result: 'ok' }, { id: S2, result: 'ok' }];

type Json = Record<string, unknown>;

function api(action: string, p: Json): Json {
  switch (action) {
    case 'status':
      return { role: 'master', node_id: MASTER, version: VERSION, hostname: HOSTNAME, lan_ip: `${LAN}.1`,
        wan_ip: '192.168.100.14', wan_proto: 'dhcp', uptime: now() - BOOT, clients: 4, internet: true, dhcp: true,
        ssid: SSID, master_ip: `${LAN}.1`, last_sync: now() - 600, slaves: 2, pw_changed: true, mac: 'aa:bb:cc:00:00:01' };
    case 'isp':
      return { public_ip: '203.0.113.42', asn: 64500, org: 'Example Broadband Inc.', isp: 'Example Broadband',
        domain: 'example.net', ts: now() - 3600 };
    case 'nodes': return { nodes: nodes() };
    case 'mesh_clients': return { stations };
    case 'assoclist': return { stations: stations.filter((s) => s.node === MASTER) };
    case 'host_names': return { names: {} };
    case 'get_config': return { config };
    case 'get_wifi':
      return { radios: [
        { device: 'wl0', ssid: SSID, channel: 'auto', live: SSID, current: '6' },
        { device: 'wl1', ssid: SSID, channel: 'auto', live: SSID, current: '149' },
      ] };
    case 'list_static':
      return { leases: [
        { mac: '00:24:BE:6E:77:08', ip: `${LAN}.127`, name: 'PS5' },
        { mac: 'DC:A6:32:4C:AA:0B', ip: `${LAN}.130`, name: 'raspberrypi' },
      ] };
    case 'discover': return { found: [{ ip: `${LAN}.4`, mac: 'aa:bb:cc:00:00:31' }] };
    case 'adopt_node': return { id: `node${String(p.ip ?? '').split('.')[3] || '4'}`, sync: 'ok' };
    case 'sync_nodes': return { results: okSync() };
    case 'set_wifi': return { note: 'demo mode: nothing was changed', sync: okSync() };
    case 'set_password': return { sync: okSync() };
    case 'set_static': return { note: 'demo mode: nothing was changed' };
    case 'get_log': return { log: log(MASTER) };
    case 'node_log': return { log: log(String(p.node_id ?? S1)) };
    // remove_node, node_reboot, set_node_name, set_device_name, set_lan, set_wan,
    // set_dhcp, del_static, set_speed, set_block, reboot: accepted, nothing changes
    default: return {};
  }
}

const uci: Record<string, Json> = {
  'network.wan': { proto: 'dhcp' },
  'network.lan': { proto: 'static', ipaddr: `${LAN}.1`, netmask: '255.255.255.0' },
  'dhcp.lan': { start: '100', limit: '150', leasetime: '12h' },
};

function ubus(obj: string, method: string, args: Json): Json {
  if (obj === 'session' && method === 'login') {
    return { ubus_rpc_session: 'd'.repeat(32), timeout: 300, expires: 300, acls: {} };
  }
  if (obj === 'session') return {};
  if (obj === 'system' && method === 'board') {
    return { kernel: '4.19.183', hostname: HOSTNAME, system: 'ARMv7 Processor rev 5 (v7l)',
      model: 'Motorola Q11 (MH7603)', board_name: 'bcm947622',
      release: { distribution: 'OpenWrt', version: '2.0.1.390', target: 'brcmbca/bcm947622', description: 'OpenWrt OEM' } };
  }
  if (obj === 'system' && method === 'info') {
    return { localtime: now(), uptime: now() - BOOT, load: [18000, 16000, 15000],
      memory: { total: 508000000, free: 190000000, available: 262000000, buffered: 9000000, cached: 70000000, shared: 2000000 } };
  }
  if (obj === 'luci-rpc' && method === 'getDHCPLeases') return { dhcp_leases: leases() };
  if (obj === 'uci' && method === 'get') return { values: uci[`${args.config}.${args.section}`] ?? {} };
  return {};
}

// Actions after which the real router goes away for a while.
const REBOOTS = new Set(['reboot', 'set_wifi', 'set_lan']);
let downFrom = 0;
let downUntil = 0;

export type MockResult =
  | { kind: 'pass' }                                  // not a router endpoint
  | { kind: 'down' }                                  // simulated reboot: drop the request
  | { kind: 'json'; status: number; body: unknown };

/** Answers one request the way the real router would, with fictional data. */
export function handleMock(path: string, method: string, bodyText: string): MockResult {
  const isUbus = path === '/ubus' || path.startsWith('/ubus/');
  const isApi = path === '/cgi-bin/freedom-api.sh';
  if (!isUbus && !isApi) return { kind: 'pass' };
  const t = Date.now();
  if (t >= downFrom && t < downUntil) return { kind: 'down' };
  if (method !== 'POST') return { kind: 'json', status: 405, body: { ok: false, error: 'POST only' } };

  let j: Json = {};
  try { j = JSON.parse(bodyText || '{}'); } catch { /* keep {} */ }

  if (isUbus) {
    const [, obj, method2, args] = (j.params as [string, string, string, Json]) ?? [];
    return { kind: 'json', status: 200, body: { jsonrpc: '2.0', id: j.id, result: [0, ubus(obj, method2, args ?? {})] } };
  }
  const action = String(j.action ?? '');
  if (!action) return { kind: 'json', status: 400, body: { ok: false, error: 'Missing action.' } };
  if (REBOOTS.has(action) && j.reboot !== '0') { downFrom = t + 1500; downUntil = t + 12000; }
  return { kind: 'json', status: 200, body: { ok: true, ...api(action, j) } };
}
