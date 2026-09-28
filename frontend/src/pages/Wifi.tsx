import { useState, useEffect } from 'react';
import { Wifi as WifiIcon, Save, Info, QrCode } from 'lucide-react';
import { Card, Empty, Button, Field, Loading } from '../components/ui';
import { useToast, errMsg } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { useReboot } from '../components/Rebooting';
import { WifiQr, ShareWifiModal } from '../components/WifiQr';
import { usePoll } from '../lib/usePoll';
import { getWifi, setWifi, BAD_CHARS, type RadioState } from '../lib/meshApi';
import { useNode } from '../status';

interface WifiState {
  ssid: string;       // shown SSID (from 2.4G; both bands share name)
  ch24: string;       // 2.4G channel setting
  ch5: string;        // 5G channel setting
  cur24: string;      // channel in use right now
  cur5: string;
}

async function getWireless(): Promise<WifiState> {
  const radios: RadioState[] = await getWifi();
  const wl0 = radios.find((r) => r.device === 'wl0');
  const wl1 = radios.find((r) => r.device === 'wl1');
  return {
    ssid: wl0?.ssid ?? wl1?.ssid ?? '',
    ch24: wl0?.channel || 'auto',
    ch5: wl1?.channel || 'auto',
    cur24: wl0?.current ?? '',
    cur5: wl1?.current ?? '',
  };
}

const CH24 = ['auto', '1', '6', '11'];
const CH5 = ['auto', '36', '40', '44', '48', '149', '153', '157', '161'];
const BAD = 'Quotes, \\, $ and ` are not allowed.';

export function Wifi() {
  const s = useNode();
  const toast = useToast();
  const confirm = useConfirm();
  const reboot = useReboot();
  // read once: saving reboots the node anyway, and a poll would reset the form
  const { data, loading, error } = usePoll(getWireless, 3_600_000);

  const [ssid, setSsid] = useState('');
  const [key, setKey] = useState('');
  const [ch24, setCh24] = useState('auto');
  const [ch5, setCh5] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState(false);

  useEffect(() => {
    if (data) { setSsid(data.ssid); setCh24(data.ch24); setCh5(data.ch5); }
  }, [data]);

  const name = ssid.trim();
  const ssidErr = !name ? 'The name cannot be empty.' : BAD_CHARS.test(name) ? BAD : '';
  const keyErr = key && key.length < 8 ? 'At least 8 characters.' : key.length > 63 ? 'At most 63 characters.'
    : BAD_CHARS.test(key) ? BAD : '';
  const dirty = !!data && (name !== data.ssid || !!key || ch24 !== data.ch24 || ch5 !== data.ch5);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ssidErr || keyErr || !dirty) return;
    const credsChange = name !== data!.ssid || !!key;
    const ok = await confirm({
      title: 'Apply WiFi changes',
      message: <>
        <p>To apply the WiFi the master <strong>reboots once</strong> (~1 min) and everyone loses the connection for a moment.</p>
        {credsChange && s.slaves > 0 && <p>The name and password are copied first to the {s.slaves} node(s), which reboot too.</p>}
        {credsChange && <p>When it is back, connect your devices to <strong>{name}</strong>{key ? ' with the new password' : ''}.</p>}
      </>,
      confirmLabel: 'Save and reboot',
    });
    if (!ok) return;

    setBusy(true);
    try {
      // Channels can differ per band: save them without rebooting, then the
      // final all-bands call (same name/key on both) carries the one reboot.
      if (ch24 !== data!.ch24) await setWifi({ device: 'wl0', channel: ch24, reboot: '0' });
      if (ch5 !== data!.ch5) await setWifi({ device: 'wl1', channel: ch5, reboot: '0' });
      await setWifi({ device: 'all', ssid: name, key: key || undefined });
    } catch (ex) {
      // the reboot can cut the answer; only a validation error is a real failure
      if (!(ex instanceof Error) || !/No connection/.test(ex.message)) {
        toast.err(errMsg(ex));
        setBusy(false);
        return;
      }
    }
    reboot({
      title: 'Applying the WiFi',
      message: credsChange ? <>
        <p>If this device uses WiFi, connect it to <strong>{name}</strong> when the network shows up again.</p>
        {key && <>
          <p>Scan this code with your phone to join the new network:</p>
          <WifiQr ssid={name} wifiKey={key} size={180} />
        </>}
      </> : <p>The master is back in ~1 minute with the new channels.</p>,
    });
  };

  if (loading && !data) return <div className="page"><Card><Loading /></Card></div>;
  if (!data) return <div className="page"><Card><Empty message={error?.message ?? 'No WiFi networks configured.'} /></Card></div>;

  return (
    <div className="page">
      <header className="page-head"><h1>WiFi</h1></header>

      <Card title="WiFi network (2.4 GHz + 5 GHz)" icon={<WifiIcon size={18} />}
            actions={<Button variant="ghost" onClick={() => setShare(true)} disabled={!data.ssid}>
              <QrCode size={16} /> Share
            </Button>}>
        <form onSubmit={save} className="form">
          <Field label="Network name (SSID)" htmlFor="ssid" error={ssid !== data.ssid ? ssidErr : ''}
                 hint="Both bands use the same name: devices pick the best one by themselves.">
            <input id="ssid" value={ssid} onChange={(e) => setSsid(e.target.value)} maxLength={32}
                   placeholder="My network" aria-invalid={!!ssidErr} />
          </Field>

          <Field label={<>WiFi password <span className="dim">(empty = unchanged)</span></>} htmlFor="wkey" error={keyErr}>
            <input id="wkey" type="text" value={key} onChange={(e) => setKey(e.target.value)} maxLength={63}
                   placeholder="min. 8 characters" autoComplete="off" aria-invalid={!!keyErr} />
          </Field>

          <div className="field-row">
            <Field label="2.4 GHz channel" htmlFor="ch24" hint={data.cur24 ? `In use: ${data.cur24}` : undefined}>
              <select id="ch24" value={ch24} onChange={(e) => setCh24(e.target.value)}>
                {CH24.map((c) => <option key={c} value={c}>{c === 'auto' ? 'Automatic' : c}</option>)}
              </select>
            </Field>
            <Field label="5 GHz channel" htmlFor="ch5" hint={data.cur5 ? `In use: ${data.cur5}` : undefined}>
              <select id="ch5" value={ch5} onChange={(e) => setCh5(e.target.value)}>
                {CH5.map((c) => <option key={c} value={c}>{c === 'auto' ? 'Automatic' : c}</option>)}
              </select>
            </Field>
          </div>

          {s.slaves > 0 && (
            <p className="info-box"><Info size={15} />
              <span>The name and password are copied to the {s.slaves} node(s). Channels are not: each node picks its own.</span>
            </p>
          )}
          <Button type="submit" disabled={busy || !dirty || !!ssidErr || !!keyErr}>
            <Save size={16} /> {busy ? 'Applying…' : 'Save and apply'}
          </Button>
        </form>
      </Card>

      <ShareWifiModal open={share} onClose={() => setShare(false)} ssid={name || data.ssid}
                      initialKey={keyErr ? '' : key} />

      <p className="hint">Saving <strong>reboots the node once</strong> (~1 min): it is the only reliable way to apply WiFi changes on this hardware.</p>
    </div>
  );
}
