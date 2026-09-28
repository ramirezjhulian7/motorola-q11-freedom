import { useMemo, useState, useEffect } from 'react';
import qrcode from 'qrcode-generator';
import { Modal } from './Modal';
import { Field } from './ui';
import './feedback.css';

// Byte mode must be UTF-8: the default encoder keeps only the low byte of each
// char, so an SSID with non-ASCII letters would give a QR that doesn't connect.
qrcode.stringToBytes = (s: string) => Array.from(new TextEncoder().encode(s));

/** Escape per the WIFI: URI scheme (\ ; , : " are special). */
const esc = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');

/** Payload phone cameras understand to join a WPA/WPA2 network. */
export const wifiPayload = (ssid: string, key: string) => `WIFI:T:WPA;S:${esc(ssid)};P:${esc(key)};;`;

/** QR drawn as one SVG path (crisp at any size, no <img> data URL). */
export function WifiQr({ ssid, wifiKey, size = 220 }: { ssid: string; wifiKey: string; size?: number }) {
  const { n, d } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(wifiPayload(ssid, wifiKey), 'Byte');
    qr.make();
    const count = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
    }
    return { n: count, d: path };
  }, [ssid, wifiKey]);

  const pad = 4; // quiet zone the spec asks for
  return (
    <svg className="wifi-qr" width={size} height={size} viewBox={`${-pad} ${-pad} ${n + pad * 2} ${n + pad * 2}`}
         role="img" aria-label={`QR code to join ${ssid}`} shapeRendering="crispEdges">
      <rect x={-pad} y={-pad} width={n + pad * 2} height={n + pad * 2} fill="#fff" />
      <path d={d} fill="#0f172a" />
    </svg>
  );
}

/**
 * "Share WiFi": the router never hands the WiFi key to the app, so the QR
 * is built from the key the user types here (prefilled with the one being
 * saved, if any). It lives only in this page's memory.
 */
export function ShareWifiModal({ open, onClose, ssid, initialKey }: {
  open: boolean; onClose: () => void; ssid: string; initialKey: string;
}) {
  const [key, setKey] = useState('');
  useEffect(() => { if (open) setKey(initialKey); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = key.length >= 8 && key.length <= 63;

  return (
    <Modal open={open} onClose={onClose} title="Share WiFi">
      <div className="share-wifi">
        {ready ? (
          <>
            <WifiQr ssid={ssid} wifiKey={key} />
            <p className="hint">Open your phone's camera and point it at the code to join <strong>{ssid}</strong>.</p>
          </>
        ) : (
          <div className="wifi-qr-empty">Enter the WiFi password to generate the code</div>
        )}
        <Field label="WiFi password" htmlFor="share-key"
               hint="The one devices use to connect, not the admin password. If it does not match the real one, the code will not connect.">
          <input id="share-key" type="text" value={key} onChange={(e) => setKey(e.target.value)}
                 autoComplete="off" maxLength={63} placeholder="min. 8 characters" />
        </Field>
      </div>
    </Modal>
  );
}
