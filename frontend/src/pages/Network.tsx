import { useState, useEffect, useMemo } from 'react';
import { Network as NetIcon, Save, AlertTriangle, Globe, Pin, Plus, Trash2, Server } from 'lucide-react';
import { Card, Button, Badge, Field, Segmented, Loading, Empty } from '../components/ui';
import { useToast, errMsg } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { useReboot } from '../components/Rebooting';
import { ReserveModal } from '../components/ReserveModal';
import { usePoll } from '../lib/usePoll';
import { call } from '../lib/ubus';
import { getDevicesByNode } from '../lib/api';
import { identify } from '../lib/deviceType';
import { setLan, setDhcp, setWan, listStatic, delStatic, getNodes, BAD_CHARS, type WanUpdate } from '../lib/meshApi';
import { isIp, net3, lastOctet } from '../lib/format';
import { useNode, useStatus } from '../status';
import { t } from '../i18n';
import './Network.css';

type Proto = 'dhcp' | 'static' | 'pppoe';

interface NetState {
  lanMask: string;
  wan: { proto: Proto; ipaddr: string; netmask: string; gateway: string; dns: string; username: string; password: string };
  dhcpStart: string; dhcpLimit: string; leasetime: string;
}

type UciValues = Record<string, string | string[] | boolean | undefined>;
const uciSection = (config: string, section: string) =>
  call<{ values: UciValues }>('uci', 'get', { config, section }).then((r) => r.values ?? {}).catch(() => ({} as UciValues));
const str = (v: UciValues[string]) => (Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '');

async function getNet(): Promise<NetState> {
  const [wan, lan, dhcp] = await Promise.all([
    uciSection('network', 'wan'), uciSection('network', 'lan'), uciSection('dhcp', 'lan'),
  ]);
  const proto = str(wan.proto);
  return {
    lanMask: str(lan.netmask) || '255.255.255.0',
    wan: {
      proto: proto === 'static' || proto === 'pppoe' ? proto : 'dhcp',
      ipaddr: str(wan.ipaddr), netmask: str(wan.netmask) || '255.255.255.0', gateway: str(wan.gateway),
      dns: str(wan.dns), username: str(wan.username), password: str(wan.password),
    },
    dhcpStart: str(dhcp.start) || '100',
    dhcpLimit: str(dhcp.limit) || '150',
    leasetime: str(dhcp.leasetime) || '12h',
  };
}

const LEASES = [
  { v: '1h', l: t('1 hour') }, { v: '6h', l: t('6 hours') }, { v: '12h', l: t('12 hours') },
  { v: '24h', l: t('1 day') }, { v: '48h', l: t('2 days') }, { v: '7d', l: t('7 days') },
];

export function Network() {
  const s = useNode();
  const { refresh: refreshStatus } = useStatus();
  const toast = useToast();
  const confirm = useConfirm();
  const reboot = useReboot();
  // Read once (and again after each save): a periodic poll would overwrite what the user is typing.
  const net = usePoll(getNet, 3_600_000);
  const statics = usePoll(listStatic, 60_000);
  const devices = usePoll(getDevicesByNode, 30_000);
  const nodes = usePoll(getNodes, 60_000);
  const lan = net3(s.lan_ip);

  /* ----- WAN ----- */
  const [proto, setProto] = useState<Proto>('dhcp');
  const [wIp, setWIp] = useState('');
  const [wMask, setWMask] = useState('255.255.255.0');
  const [wGw, setWGw] = useState('');
  const [wDns, setWDns] = useState('');
  const [pUser, setPUser] = useState('');
  const [pPass, setPPass] = useState('');
  const [wanBusy, setWanBusy] = useState(false);

  /* ----- LAN / DHCP ----- */
  const [lanIp, setLanIp] = useState('');
  const [start, setStart] = useState('');
  const [limit, setLimit] = useState('');
  const [lease, setLease] = useState('12h');
  const [dhcpBusy, setDhcpBusy] = useState(false);
  const [addRes, setAddRes] = useState(false);

  const loaded = net.data;
  useEffect(() => {
    if (!loaded) return;
    const w = loaded.wan;
    setProto(w.proto); setWIp(w.ipaddr); setWMask(w.netmask); setWGw(w.gateway); setWDns(w.dns);
    setPUser(w.username); setPPass(w.password);
    setStart(loaded.dhcpStart); setLimit(loaded.dhcpLimit); setLease(loaded.leasetime);
  }, [loaded]);
  useEffect(() => { setLanIp(s.lan_ip); }, [s.lan_ip]);

  /* ----- WAN validation ----- */
  const dnsList = wDns.split(/[\s,]+/).filter(Boolean);
  const wanErr = proto === 'static' ? {
    ip: wIp && !isIp(wIp) ? t('Invalid IP address.') : '',
    mask: wMask && !isIp(wMask) ? t('Invalid netmask.') : '',
    gw: wGw && !isIp(wGw) ? t('Invalid gateway.') : '',
    dns: dnsList.some((d) => !isIp(d)) ? t('Separate DNS servers with commas: 8.8.8.8, 1.1.1.1') : '',
  } : { ip: '', mask: '', gw: '', dns: '' };
  const pppErr = proto === 'pppoe' && BAD_CHARS.test(pUser + pPass) ? t('Quotes, \\, $ and ` are not allowed.') : '';
  const wanReady = proto === 'dhcp' ? true
    : proto === 'static' ? isIp(wIp) && isIp(wGw) && !Object.values(wanErr).some(Boolean)
    : !!pUser.trim() && !pppErr;

  const saveWan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wanReady) return;
    const label = { dhcp: t('automatic (DHCP)'), static: t('static IP'), pppoe: 'PPPoE' }[proto];
    const ok = await confirm({
      title: t('Change the internet connection'),
      message: <>
        <p>{t('The WAN will switch to')} <strong>{label}</strong>. {t('Internet drops for a few seconds across the whole mesh while it applies.')}</p>
        <p>{t('If the settings are wrong, the mesh stays offline until you fix them here.')}</p>
      </>,
      confirmLabel: t('Apply'),
    });
    if (!ok) return;
    const u: WanUpdate = proto === 'dhcp' ? { proto }
      : proto === 'static' ? { proto, ipaddr: wIp.trim(), netmask: wMask.trim(), gateway: wGw.trim(), dns: dnsList.join(',') }
      : { proto, username: pUser.trim(), password: pPass };
    setWanBusy(true);
    try {
      await setWan(u);
      toast.ok(t('WAN updated. Reconnecting to the internet…'));
      setTimeout(() => { refreshStatus(); net.refresh(); }, 8000);
    } catch (ex) { toast.err(errMsg(ex)); }
    finally { setWanBusy(false); }
  };

  /* ----- LAN ----- */
  const lanErr = !isIp(lanIp) ? t('Invalid IP address.')
    : s.slaves > 0 && net3(lanIp) !== lan ? t('With nodes in the mesh you can only change it within {lan}.x.', { lan })
    : '';
  const saveLan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lanErr || lanIp === s.lan_ip) return;
    const ok = await confirm({
      title: t('Change the master IP'),
      message: <>
        <p>{t('The master will move from')} <strong className="mono">{s.lan_ip}</strong> {t('to')} <strong className="mono">{lanIp}</strong>.</p>
        <p>{t('You will lose the connection to this panel and have to open it at the new address.')}
          {s.slaves > 0 && ' ' + t('The nodes get the new IP automatically.')}</p>
      </>,
      confirmLabel: t('Change IP'), danger: true,
    });
    if (!ok) return;
    const href = `${location.protocol}//${lanIp}/app/`;
    try { await setLan(lanIp, loaded?.lanMask ?? '255.255.255.0'); }
    catch (ex) {
      // the network reloads mid-request; only a validation answer is a real error
      if (!(ex instanceof Error) || ex.message !== t('No connection to the router.')) { toast.err(errMsg(ex)); return; }
    }
    reboot({
      title: t('Changing the master IP'),
      message: <p>{t('The network is reloading. In a few seconds, open the panel at')} <strong className="mono">{lanIp}</strong>.
        {' '}{t('If your device does not reconnect by itself, disconnect it and join the WiFi again.')}</p>,
      manual: { href, label: t('Open {ip}', { ip: lanIp }) },
    });
  };

  /* ----- DHCP ----- */
  const st = parseInt(start, 10), li = parseInt(limit, 10);
  const end = st + li - 1;
  const dhcpErr = !/^\d+$/.test(start) || st < 2 || st > 254 ? t('The start must be between 2 and 254.')
    : !/^\d+$/.test(limit) || li < 1 ? t('The count must be at least 1.')
    : end > 254 ? t('The range goes past the network: it ends at .{end} (max .254).', { end })
    : '';
  const routerOct = lastOctet(s.lan_ip);
  const reservedOct = useMemo(() => (statics.data ?? []).map((r) => lastOctet(r.ip)).filter((n) => n > 0), [statics.data]);

  // Last octet -> who holds it: active leases and connected devices (even without a
  // lease), reservations, the mesh nodes and the master itself.
  const taken = useMemo(() => {
    const m = new Map<number, string>();
    const add = (ip: string | undefined, who: string) => {
      if (ip && isIp(ip) && net3(ip) === lan && !m.has(lastOctet(ip))) m.set(lastOctet(ip), who);
    };
    add(s.lan_ip, t('Master'));
    for (const n of nodes.data ?? []) add(n.ip, t('Mesh node {id}', { id: n.id }));
    for (const r of statics.data ?? []) add(r.ip, t('Reservation · {name}', { name: r.name || r.mac }));
    for (const d of devices.data ?? []) add(d.ipaddr, identify(d.mac, d.hostname).name);
    return m;
  }, [devices.data, statics.data, nodes.data, s.lan_ip, lan]);

  // Free / used addresses of the pool being edited (updates live while typing)
  const pool = useMemo(() => {
    if (dhcpErr) return null;
    let used = 0;
    for (let o = st; o <= end; o++) if (taken.has(o)) used++;
    return { free: li - used, used };
  }, [taken, st, end, li, dhcpErr]);
  const poolLoaded = !!devices.data && !!statics.data;
  const dhcpDirty = loaded && (start !== loaded.dhcpStart || limit !== loaded.dhcpLimit || lease !== loaded.leasetime);

  const saveDhcp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dhcpErr) return;
    setDhcpBusy(true);
    try {
      await setDhcp(String(st), String(li), lease);
      toast.ok(t('DHCP range: {from} – {to}.', { from: `${lan}.${st}`, to: `${lan}.${end}` }));
      setTimeout(net.refresh, 1500);
    } catch (ex) { toast.err(errMsg(ex)); }
    finally { setDhcpBusy(false); }
  };

  /* ----- reservations ----- */
  const removeRes = async (mac: string, ip: string, name: string) => {
    const ok = await confirm({
      title: t('Remove reservation'),
      message: <p>{name || mac} {t('will no longer keep the IP')} <strong className="mono">{ip}</strong>. {t('It will get one from the DHCP range when it renews.')}</p>,
      confirmLabel: t('Remove'), danger: true,
    });
    if (!ok) return;
    try { await delStatic(mac); toast.ok(t('Reservation removed.')); statics.refresh(); }
    catch (ex) { toast.err(errMsg(ex)); }
  };
  const deviceName = (mac: string) => {
    const d = devices.data?.find((x) => x.mac === mac);
    return d ? identify(d.mac, d.hostname).name : undefined;
  };
  const deviceChoices = (devices.data ?? []).filter((d) => d.conn && isIp(d.ipaddr))
    .map((d) => { const id = identify(d.mac, d.hostname); return { mac: d.mac, ip: d.ipaddr, name: id.guessed ? '' : id.name, label: id.name }; });

  if (net.loading && !loaded) return <div className="page"><Card><Loading /></Card></div>;

  return (
    <div className="page">
      <header className="page-head"><h1>{t('Network')}</h1></header>

      <Card title="Internet (WAN)" icon={<Globe size={18} />}
            actions={<Badge tone={s.internet ? 'accent' : 'danger'}>{s.internet ? t('Connected') : t('No internet')}</Badge>}>
        <form onSubmit={saveWan} className="form">
          <div className="kv">
            <div><span>{t('Current WAN IP')}</span><b className="mono">{s.wan_ip || '—'}</b></div>
          </div>
          <Segmented label={t('Connection type')} value={proto} onChange={setProto} options={[
            { value: 'dhcp', label: t('Automatic') }, { value: 'static', label: t('Static IP') }, { value: 'pppoe', label: 'PPPoE' },
          ]} />
          {proto === 'dhcp' && <p className="hint" style={{ margin: 0 }}>{t("Your provider's modem gives the master its IP. This is the usual setup.")}</p>}
          {proto === 'static' && (
            <>
              <div className="field-row">
                <Field label="IP" htmlFor="w-ip" error={wanErr.ip}>
                  <input id="w-ip" className="mono" inputMode="decimal" value={wIp} onChange={(e) => setWIp(e.target.value)} aria-invalid={!!wanErr.ip} />
                </Field>
                <Field label={t('Netmask')} htmlFor="w-mask" error={wanErr.mask}>
                  <input id="w-mask" className="mono" inputMode="decimal" value={wMask} onChange={(e) => setWMask(e.target.value)} aria-invalid={!!wanErr.mask} />
                </Field>
              </div>
              <div className="field-row">
                <Field label="Gateway" htmlFor="w-gw" error={wanErr.gw}>
                  <input id="w-gw" className="mono" inputMode="decimal" value={wGw} onChange={(e) => setWGw(e.target.value)} aria-invalid={!!wanErr.gw} />
                </Field>
                <Field label={t('DNS (optional)')} htmlFor="w-dns" error={wanErr.dns}>
                  <input id="w-dns" className="mono" value={wDns} onChange={(e) => setWDns(e.target.value)} placeholder="8.8.8.8, 1.1.1.1" aria-invalid={!!wanErr.dns} />
                </Field>
              </div>
            </>
          )}
          {proto === 'pppoe' && (
            <div className="field-row">
              <Field label={t('PPPoE username')} htmlFor="p-user" error={pppErr}>
                <input id="p-user" value={pUser} onChange={(e) => setPUser(e.target.value)} autoComplete="off" />
              </Field>
              <Field label={t('PPPoE password')} htmlFor="p-pass">
                <input id="p-pass" type="password" value={pPass} onChange={(e) => setPPass(e.target.value)} autoComplete="new-password" />
              </Field>
            </div>
          )}
          <Button type="submit" disabled={!wanReady || wanBusy}><Save size={16} /> {wanBusy ? t('Applying…') : t('Apply WAN')}</Button>
        </form>
      </Card>

      <Card title="DHCP" icon={<Server size={18} />} actions={<Badge tone={s.dhcp ? 'accent' : 'muted'}>{s.dhcp ? t('On') : t('Off')}</Badge>}>
        <form onSubmit={saveDhcp} className="form">
          <div className="field-row">
            <Field label={t('First IP (last number)')} htmlFor="d-start">
              <input id="d-start" className="mono" inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label={t('Number of addresses')} htmlFor="d-limit">
              <input id="d-limit" className="mono" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} />
            </Field>
          </div>
          <Field label={t('Lease time')} htmlFor="d-lease">
            <select id="d-lease" value={lease} onChange={(e) => setLease(e.target.value)}>
              {!LEASES.some((l) => l.v === lease) && <option value={lease}>{lease}</option>}
              {LEASES.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
            </select>
          </Field>

          <div className={'dhcp-preview' + (dhcpErr ? ' bad' : '')} aria-live="polite">
            {dhcpErr ? <p className="field-err">{dhcpErr}</p> : (
              <p><span className="mono">{lan}.{st}</span> → <span className="mono">{lan}.{end}</span> · <b>{li}</b> {t('addresses')}</p>
            )}
            {pool && poolLoaded && (
              <div className={'dhcp-free' + (pool.free === 0 ? ' none' : pool.free < li * 0.1 ? ' low' : '')}>
                <strong className="mono">{pool.free}</strong> {t('free')} · <span className="mono">{pool.used}</span> {t('in use')}
                <span className="dhcp-free-bar" aria-hidden="true"><i style={{ width: `${(pool.used / li) * 100}%` }} /></span>
              </div>
            )}
            <div className="dhcp-bar" aria-hidden="true">
              {!dhcpErr && <i className="pool" style={{ left: `${((st - 1) / 254) * 100}%`, width: `${(li / 254) * 100}%` }} />}
              {[...taken.keys()].filter((o) => !reservedOct.includes(o) && o !== routerOct).map((o) => (
                <i key={`u${o}`} className="used" title={`${lan}.${o} · ${taken.get(o)}`} style={{ left: `${((o - 1) / 254) * 100}%` }} />
              ))}
              {reservedOct.map((o) => <i key={o} className="res" style={{ left: `${((o - 1) / 254) * 100}%` }} />)}
              {routerOct > 0 && <i className="router" style={{ left: `${((routerOct - 1) / 254) * 100}%` }} />}
            </div>
            <div className="dhcp-legend">
              <span className="mono">.1</span>
              <span><i className="lg pool" /> {t('range')}</span>
              <span><i className="lg router" /> {t('master')}</span>
              <span><i className="lg used" /> {t('in use')}</span>
              {reservedOct.length > 0 && <span><i className="lg res" /> {t('reserved')}</span>}
              <span className="mono">.254</span>
            </div>
          </div>
          <p className="hint" style={{ margin: 0 }}>{t('Slave nodes use low static IPs ({lan}.2, .3…). Keep those out of the range.', { lan })}</p>
          <Button type="submit" disabled={!!dhcpErr || dhcpBusy || !dhcpDirty}><Save size={16} /> {dhcpBusy ? t('Saving…') : t('Save DHCP')}</Button>
        </form>
      </Card>

      <Card title={t('IP reservations')} icon={<Pin size={18} />}
            actions={<Button variant="ghost" onClick={() => setAddRes(true)}><Plus size={16} /> {t('New')}</Button>}>
        {statics.loading && !statics.data ? <Loading />
          : !statics.data?.length ? <Empty message={t('No reservations. Reserve an IP so a device always gets the same one.')} />
          : (
          <ul className="res-list">
            {[...statics.data].sort((a, b) => lastOctet(a.ip) - lastOctet(b.ip)).map((r) => (
              <li key={r.mac}>
                <span className="mono res-ip">{r.ip}</span>
                <div className="res-who">
                  <strong>{r.name || deviceName(r.mac) || t('Unnamed')}</strong>
                  <span className="mono dim">{r.mac}</span>
                </div>
                <button className="icon-btn" onClick={() => removeRes(r.mac, r.ip, r.name)} aria-label={t('Remove reservation for {ip}', { ip: r.ip })}>
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('LAN (local network)')} icon={<NetIcon size={18} />}>
        <form onSubmit={saveLan} className="form">
          <p className="warn-box"><AlertTriangle size={15} /> {t('Changing the master IP disconnects you from this panel.')}</p>
          <div className="field-row">
            <Field label={t('Master IP')} htmlFor="l-ip" error={lanIp !== s.lan_ip ? lanErr : ''}>
              <input id="l-ip" className="mono" inputMode="decimal" value={lanIp} onChange={(e) => setLanIp(e.target.value)} aria-invalid={!!lanErr} />
            </Field>
            <Field label={t('Netmask')}>
              <input value={loaded?.lanMask ?? ''} readOnly className="mono dim-input" />
            </Field>
          </div>
          <Button type="submit" variant="ghost" disabled={!!lanErr || lanIp === s.lan_ip}><Save size={16} /> {t('Change IP')}</Button>
        </form>
      </Card>

      <ReserveModal open={addRes} onClose={() => setAddRes(false)} lanIp={s.lan_ip}
                    reserved={statics.data ?? []} devices={deviceChoices} onSaved={statics.refresh} />
    </div>
  );
}
