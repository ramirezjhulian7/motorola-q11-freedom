/* ===========================================================================
   Device identification — heuristic, runs in the SPA.
   Inputs: DHCP hostname (from the lease, or remembered by the router) and the
   MAC's vendor prefix (ouiData.ts, generated from Wireshark's list). Output: a
   readable name, the vendor and a device type. No DPI, so it is an estimate:
   the user can always set a custom name.
   =========================================================================== */

export type DeviceType =
  | 'phone' | 'computer' | 'console' | 'tv' | 'iot' | 'camera' | 'printer' | 'router' | 'unknown';

export const TYPE_LABEL: Record<DeviceType, string> = {
  phone: 'Phone',
  computer: 'Computer',
  console: 'Console',
  tv: 'TV / Media',
  iot: 'Smart home',
  camera: 'Camera',
  printer: 'Printer',
  router: 'Network',
  unknown: 'Unknown',
};

// Name built from the vendor: "Hikvision camera", "ASUS device".
const TYPE_NOUN: Record<DeviceType, string> = {
  phone: 'phone', computer: 'computer', console: 'console', tv: 'TV', iot: 'device',
  camera: 'camera', printer: 'printer', router: 'router', unknown: 'device',
};

/* ----- vendor by MAC prefix (lazy: ~33 KB gzip, only where it's needed) --- */
interface Vendor { brand: string; hint: DeviceType | 'oem' | ''; }
let ouiMap: Map<string, Vendor> | null = null;

export async function loadVendors(): Promise<void> {
  if (ouiMap) return;
  const { OUI_BRANDS } = await import('./ouiData');
  const m = new Map<string, Vendor>();
  for (const [brand, hint, list] of OUI_BRANDS) {
    for (const oui of list.split(' ')) m.set(oui, { brand, hint: hint as Vendor['hint'] });
  }
  ouiMap = m;
}

/** Locally administered bit: phones/PCs use a random "private" MAC per network. */
export const isPrivateMac = (mac: string) => (parseInt(mac.slice(0, 2), 16) & 2) !== 0;

export function vendorOf(mac: string): Vendor | null {
  if (!ouiMap || isPrivateMac(mac)) return null;
  return ouiMap.get(mac.replace(/[:-]/g, '').toUpperCase().slice(0, 6)) ?? null;
}

/* ----- hostnames ---------------------------------------------------------- */
// Well-known default hostnames -> a real name. Only patterns we are sure of.
const KNOWN: Array<[RegExp, (m: RegExpMatchArray) => string, DeviceType, string?]> = [
  [/^HL_CAM(\d)\b/i, (m) => `Wyze Cam v${m[1]}`, 'camera'],
  [/^WYZE_CAKP2JFUS\b/i, () => 'Wyze Cam v3', 'camera'],
  [/^(HS|KP|KS|EP|ES)\d{2,3}[A-Z]?$/, (m) => `Kasa ${m[0]}`, 'iot', 'TP-Link'],   // Kasa plugs/switches
  [/^NPI[0-9A-F]{6}$/i, () => 'HP printer', 'printer'],
  [/^HP[0-9A-F]{6}$/, () => 'HP printer', 'printer'],
  [/^EPSON[0-9A-F]{6}$/i, () => 'Epson printer', 'printer'],
  [/^BRW[0-9A-F]{12}$/i, () => 'Brother printer', 'printer'],
  [/^amazon-[0-9a-f]+$/i, () => 'Amazon device', 'iot'],                    // Echo / Fire TV
  [/^android-[0-9a-f]{16}$/i, () => 'Android phone', 'phone'],
  [/^ESP[_-][0-9A-F]{6}$/i, () => 'ESP module', 'iot'],
  [/^(DESKTOP|LAPTOP)-[A-Z0-9]{7,8}$/, () => 'Windows PC', 'computer'],
];

// Keyword -> type. Order matters: the first match wins.
const HOST_RULES: Array<[RegExp, DeviceType]> = [
  [/iphone|galaxy|pixel|redmi|huawei|oneplus|moto|android|sm-|honor|^s\d{2}\b/i, 'phone'],
  [/playstation|ps4|ps5|xbox|nintendo|switch|wii/i, 'console'],
  [/cam|camera|ipc|dvr|nvr|doorbell/i, 'camera'],
  [/printer|laserjet|officejet|deskjet|epson|brother/i, 'printer'],
  [/macbook|imac|mac-?mini|^mac$|-air$|\bpc\b|desktop|laptop|windows|win-|thinkpad|dell|hp-|lenovo|ubuntu|fedora/i, 'computer'],
  [/tv|roku|firestick|fire-?tv|chromecast|appletv|shield|bravia|webos/i, 'tv'],
  [/echo|alexa|nest|hue|tuya|sonoff|esp32|shelly|raspberry|rpi|dryer|washer|fridge|refrigerator|oven|vacuum|roomba|plug/i, 'iot'],
  [/router|gateway|mesh|repeater|ap-/i, 'router'],
];

/** "HL_CAM4-80482C41CECF.lan" -> "HL CAM4"; "Galaxy-S25-Ultra" -> "Galaxy S25 Ultra". */
export function prettyHost(h: string): string {
  const s = h.replace(/\.(lan|local|home)$/i, '')
    .replace(/[-_]?[0-9A-F]{12}$/i, '')          // MAC glued at the end
    .replace(/[-_]+/g, ' ').trim();
  return s || h;
}

export function detectType(mac: string, hostname: string): DeviceType {
  for (const [re, t] of HOST_RULES) if (hostname && re.test(hostname)) return t;
  const v = vendorOf(mac);
  if (v && v.hint && v.hint !== 'oem') return v.hint;
  return 'unknown';
}

export interface Identity {
  name: string;         // what to show
  guessed: boolean;     // built from the vendor, the device sent no name
  vendor: string | null;
  oem: boolean;         // vendor makes WiFi modules: it doesn't say what the device is
  privateMac: boolean;
  type: DeviceType;
}

export function identify(mac: string, hostname: string): Identity {
  const v = vendorOf(mac);
  const base = { vendor: v?.brand ?? null, oem: v?.hint === 'oem', privateMac: isPrivateMac(mac) };
  const h = hostname.replace(/\.(lan|local|home)$/i, '');
  if (h) {
    for (const [re, name, type, brand] of KNOWN) {
      const m = h.match(re);
      if (m && (!brand || brand === v?.brand)) return { ...base, name: name(m), guessed: false, type };
    }
    let name = prettyHost(h);
    // a bare model code ("GW3U") says more with the brand in front
    if (/^[A-Z0-9]{2,8}$/.test(name) && /\d/.test(name) && v && !base.oem) name = `${v.brand} ${name}`;
    return { ...base, name, guessed: false, type: detectType(mac, h) };
  }
  const type = detectType(mac, '');
  // Motorola prefix + no name: almost surely a Q11 router that is not in the mesh
  if (v?.brand === 'Motorola') return { ...base, name: 'Motorola router', guessed: true, type: 'router' };
  if (v && !base.oem) return { ...base, name: `${v.brand} ${TYPE_NOUN[type]}`, guessed: true, type };
  return {
    ...base, guessed: true, type,
    name: base.privateMac ? 'Device with private MAC' : 'Unnamed device',
  };
}
