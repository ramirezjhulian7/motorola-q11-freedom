import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Button, Field } from './ui';
import { useToast, errMsg } from './Toast';
import { setStatic, type StaticLease } from '../lib/meshApi';
import { isIp, net3, MAC_RE } from '../lib/format';

export interface ReserveTarget { mac: string; ip: string; name: string; label?: string; }

/** Hostname the backend will store: letters, digits and dashes (max 32). */
const toHost = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 32);

/**
 * Create / edit an IP reservation. With `target` the device is fixed (from the
 * device list); without it the user types the MAC or picks a connected device.
 */
export function ReserveModal({ open, onClose, target, lanIp, reserved, devices, onSaved }: {
  open: boolean;
  onClose: () => void;
  target?: ReserveTarget | null;
  lanIp: string;
  reserved: StaticLease[];
  devices?: ReserveTarget[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const [mac, setMac] = useState('');
  const [ip, setIp] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const lan = net3(lanIp);

  useEffect(() => {
    if (!open) return;
    const existing = target && reserved.find((r) => r.mac === target.mac);
    setMac(target?.mac ?? '');
    setIp(existing?.ip ?? (target && isIp(target.ip) && net3(target.ip) === lan ? target.ip : ''));
    setName(existing?.name ?? toHost(target?.name && target.name !== '(no name)' ? target.name : ''));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when it opens

  const macU = mac.trim().toUpperCase();
  const ipT = ip.trim();
  const macErr = macU && !MAC_RE.test(macU) ? 'Use the MAC format AA:BB:CC:DD:EE:FF.' : '';
  const ipErr = !ipT ? ''
    : !isIp(ipT) ? 'Invalid IP address.'
    : net3(ipT) !== lan ? `It must be on the ${lan}.x network.`
    : ipT === lanIp ? 'That is the master\'s IP.'
    : reserved.some((r) => r.ip === ipT && r.mac !== macU) ? 'That IP is already reserved for another device.'
    : '';
  const ok = MAC_RE.test(macU) && isIp(ipT) && !ipErr;

  const pickDevice = (m: string) => {
    const d = devices?.find((x) => x.mac === m);
    setMac(m);
    if (d) {
      if (isIp(d.ip) && net3(d.ip) === lan) setIp(d.ip);
      setName(toHost(d.name === '(no name)' ? '' : d.name));
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    try {
      await setStatic(macU, ipT, toHost(name));
      toast.ok(`IP ${ipT} reserved. The device gets it when it renews its connection.`);
      onSaved();
      onClose();
    } catch (ex) { toast.err(errMsg(ex)); }
    finally { setBusy(false); }
  };

  const freeDevices = (devices ?? []).filter((d) => !reserved.some((r) => r.mac === d.mac));

  return (
    <Modal open={open} onClose={onClose} title={target ? `Reserve IP · ${target.label || target.name || target.mac}` : 'New IP reservation'}
           locked={busy}
           footer={<>
             <Button variant="ghost" onClick={onClose}>Cancel</Button>
             <Button type="submit" form="reserve-form" disabled={!ok || busy}>{busy ? 'Saving…' : 'Reserve'}</Button>
           </>}>
      <form id="reserve-form" className="form" onSubmit={save}>
        <p className="hint" style={{ margin: 0 }}>
          The router will always give this device the same IP. Useful for printers, cameras or port forwarding.
        </p>
        {target ? (
          <Field label="Device"><input value={target.mac} readOnly className="mono dim-input" /></Field>
        ) : (
          <>
            {freeDevices.length > 0 && (
              <Field label="Pick a connected device" htmlFor="res-dev">
                <select id="res-dev" value={freeDevices.some((d) => d.mac === macU) ? macU : ''}
                        onChange={(e) => pickDevice(e.target.value)}>
                  <option value="">— Type the MAC by hand —</option>
                  {freeDevices.map((d) => <option key={d.mac} value={d.mac}>{d.label || d.name || d.mac} · {d.ip}</option>)}
                </select>
              </Field>
            )}
            <Field label="MAC" htmlFor="res-mac" error={macErr}>
              <input id="res-mac" className="mono" value={mac} placeholder="AA:BB:CC:DD:EE:FF"
                     onChange={(e) => setMac(e.target.value)} aria-invalid={!!macErr} />
            </Field>
          </>
        )}
        <Field label="Reserved IP" htmlFor="res-ip" error={ipErr}>
          <input id="res-ip" className="mono" inputMode="decimal" value={ip} placeholder={`${lan}.50`}
                 onChange={(e) => setIp(e.target.value)} aria-invalid={!!ipErr} autoFocus={!!target} />
        </Field>
        <Field label="Network name (optional)" htmlFor="res-name"
               hint={name && toHost(name) !== name ? `It will be saved as "${toHost(name)}".` : 'Letters, digits and dashes only.'}>
          <input id="res-name" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="printer" />
        </Field>
      </form>
    </Modal>
  );
}
