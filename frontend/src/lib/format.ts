export function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtBytes(b: number): string {
  if (b >= 1 << 30) return (b / (1 << 30)).toFixed(1) + ' GB';
  if (b >= 1 << 20) return (b / (1 << 20)).toFixed(0) + ' MB';
  return (b / 1024).toFixed(0) + ' KB';
}

export function memPercent(total: number, available: number): number {
  return Math.round(((total - available) / total) * 100);
}

/** ubus load is fixed-point /65536. Returns 1-min load avg. */
export function loadAvg(load: [number, number, number]): number {
  return +(load[0] / 65536).toFixed(2);
}

/** "5 min ago" from a unix timestamp (seconds). 0 = never. */
export function fmtAgo(ts: number | undefined): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/* ----- IPv4 helpers ------------------------------------------------------ */
export const IP_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export const isIp = (s: string) => IP_RE.test(s.trim());
export const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

/** "192.168.50.1" -> "192.168.50" */
export const net3 = (ip: string) => ip.split('.').slice(0, 3).join('.');
export const lastOctet = (ip: string) => parseInt(ip.split('.')[3] ?? '', 10);
