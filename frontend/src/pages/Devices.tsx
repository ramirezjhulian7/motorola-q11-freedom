import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw, Pencil, Gauge, Check, X, Cable, Search, PauseCircle, PlayCircle, Pin, Router,
} from 'lucide-react';
import { Card, Badge, SignalBars, Empty, Button, DeviceIcon, Loading } from '../components/ui';
import { useToast, errMsg } from '../components/Toast';
import { ReserveModal, type ReserveTarget } from '../components/ReserveModal';
import { usePoll } from '../lib/usePoll';
import { getDevicesByNode, type ConnectedDevice } from '../lib/api';
import {
  getFreedomConfig, getNodes, listStatic, setDeviceName, setSpeed, setBlock, BAD_CHARS,
} from '../lib/meshApi';
import { identify, loadVendors, TYPE_LABEL, type DeviceType } from '../lib/deviceType';
import { nodeLabel } from '../lib/nodes';
import { isIp } from '../lib/format';
import { useNode } from '../status';
import './Devices.css';

const SPEED_PRESETS = [
  { label: 'No limit', kbit: 0 },
  { label: '2 Mbps', kbit: 2000 },
  { label: '5 Mbps', kbit: 5000 },
  { label: '10 Mbps', kbit: 10000 },
  { label: '20 Mbps', kbit: 20000 },
];

type Kind = 'all' | 'wifi' | 'cable' | 'paused';

interface Row extends ConnectedDevice {
  displayName: string;
  guessed: boolean;          // name built from the vendor (the device sent none)
  vendor: string | null;
  oem: boolean;
  privateMac: boolean;
  type: DeviceType;
  limited: number;
  paused: boolean;
  reservedIp: string | null;
  nodeName: string | null;   // this MAC is a node of the mesh itself
  noLease: boolean;          // connected but without a DHCP lease (lost on reboot)
  absent: boolean;           // paused, but not connected right now
}

export function Devices() {
  const status = useNode();
  const toast = useToast();
  const devs = usePoll(getDevicesByNode, 10_000);
  const cfg = usePoll(getFreedomConfig, 30_000);
  const statics = usePoll(listStatic, 60_000);
  const nodes = usePoll(getNodes, 30_000);

  const names = cfg.data?.deviceNames ?? {};
  const nodeNames = cfg.data?.nodeNames ?? {};

  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [node, setNode] = useState('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [speedFor, setSpeedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reserve, setReserve] = useState<ReserveTarget | null>(null);
  const [type, setType] = useState<DeviceType | 'all'>('all');
  // vendor table is a separate chunk: rows re-identify once it arrives
  const [vendorsReady, setVendorsReady] = useState(false);
  useEffect(() => { loadVendors().then(() => setVendorsReady(true)).catch(() => {}); }, []);

  const rows = useMemo<Row[]>(() => {
    const names = cfg.data?.deviceNames ?? {};
    const nodeNames = cfg.data?.nodeNames ?? {};
    const qos = cfg.data?.qos ?? {};
    const blocked = new Set(cfg.data?.blocked ?? []);
    const res = new Map((statics.data ?? []).map((s) => [s.mac, s.ip]));
    const nodeByMac = new Map((nodes.data ?? []).filter((n) => n.mac).map((n) => [n.mac!.toUpperCase(), n.id]));
    const list = devs.data ?? [];
    const seen = new Set(list.map((d) => d.mac));

    // Paused devices that are not connected now still need a "Resume" button.
    const absent: ConnectedDevice[] = [...blocked].filter((m) => !seen.has(m)).map((mac) => ({
      mac, hostname: '', nameSource: null, leased: false, ipaddr: '—',
      nodeId: null, conn: null, band: null, signal: null, expires: -1,
    }));

    return [...list, ...absent].map((d) => {
      const nodeId = nodeByMac.get(d.mac);
      const nodeName = nodeId ? nodeLabel(nodeId, nodeNames) : null;
      const id = identify(d.mac, d.hostname);
      const custom = names[d.mac] || (nodeName ? (/^node\b/i.test(nodeName) ? nodeName : `${nodeName} node`) : '');
      return {
        ...d,
        ...id,
        displayName: custom || id.name,
        guessed: !custom && id.guessed,
        type: nodeName ? 'router' : id.type,
        limited: qos[d.ipaddr] || 0,
        paused: blocked.has(d.mac),
        reservedIp: res.get(d.mac) ?? null,
        nodeName,
        noLease: !d.leased && d.expires !== -1,
        absent: d.expires === -1,
      };
    }).sort((a, b) =>
      Number(!a.conn) - Number(!b.conn) || Number(!!a.nodeName) - Number(!!b.nodeName) ||
      Number(a.guessed) - Number(b.guessed) || a.displayName.localeCompare(b.displayName));
  }, [devs.data, cfg.data, statics.data, nodes.data, vendorsReady]); // eslint-disable-line react-hooks/exhaustive-deps -- vendorsReady: re-run once the table loads

  const counts = useMemo(() => ({
    all: rows.length,
    wifi: rows.filter((r) => r.conn === 'wifi').length,
    cable: rows.filter((r) => r.conn === 'cable').length,
    paused: rows.filter((r) => r.paused).length,
  }), [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (kind === 'wifi' && r.conn !== 'wifi') return false;
      if (kind === 'cable' && r.conn !== 'cable') return false;
      if (kind === 'paused' && !r.paused) return false;
      if (node !== 'all' && r.nodeId !== node) return false;
      if (type !== 'all' && r.type !== type) return false;
      if (needle && ![r.displayName, r.hostname, r.ipaddr, r.mac, r.vendor ?? '', TYPE_LABEL[r.type]]
        .some((s) => s.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [rows, q, kind, node, type]);

  const refreshAll = () => { devs.refresh(); cfg.refresh(); statics.refresh(); nodes.refresh(); };

  const saveName = async (mac: string) => {
    const name = draft.trim();
    if (BAD_CHARS.test(name)) return toast.err('The name cannot contain quotes, \\, $ or `.');
    try {
      await setDeviceName(mac, name);
      setEditing(null);
      cfg.refresh();
    } catch (e) { toast.err(errMsg(e)); }
  };

  const applySpeed = async (d: Row, kbit: number) => {
    setBusy(d.mac);
    try {
      await setSpeed(d.ipaddr, kbit);
      setSpeedFor(null);
      cfg.refresh();
      toast.ok(kbit ? `${d.displayName}: download limited to ${kbit / 1000} Mbps.` : `${d.displayName}: no speed limit.`);
    } catch (e) { toast.err(errMsg(e)); }
    finally { setBusy(null); }
  };

  const togglePause = async (d: Row) => {
    setBusy(d.mac);
    try {
      await setBlock(d.mac, !d.paused);
      await cfg.refresh();
      toast.ok(d.paused ? `${d.displayName} has internet again.` : `Internet paused for ${d.displayName} across the whole mesh.`);
    } catch (e) { toast.err(errMsg(e)); }
    finally { setBusy(null); }
  };

  const nodeOptions = (nodes.data ?? []).map((n) => ({ id: n.id, label: nodeLabel(n.id, nodeNames) }));
  const typeOptions = useMemo(() => {
    const c = new Map<DeviceType, number>();
    for (const r of rows) c.set(r.type, (c.get(r.type) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Devices</h1>
        <Button variant="ghost" onClick={refreshAll}><RefreshCw size={16} /> Refresh</Button>
      </header>

      <div className="dev-filters">
        <label className="search">
          <Search size={16} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Search by name, IP or MAC" aria-label="Search devices" />
        </label>
        <div className="dev-filter-row">
          <div className="btn-row" role="group" aria-label="Connection type">
            {([['all', 'All'], ['wifi', 'WiFi'], ['cable', 'Wired'], ['paused', 'Paused']] as [Kind, string][]).map(([k, l]) => (
              <button key={k} className={'chip' + (kind === k ? ' on' : '')} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {l} <span className="count">{counts[k]}</span>
              </button>
            ))}
          </div>
          <div className="btn-row">
          {typeOptions.length > 1 && (
            <select className="node-select" value={type} onChange={(e) => setType(e.target.value as DeviceType | 'all')} aria-label="Filter by type">
              <option value="all">All types</option>
              {typeOptions.map(([t, n]) => <option key={t} value={t}>{TYPE_LABEL[t]} ({n})</option>)}
            </select>
          )}
          {nodeOptions.length > 1 && (
            <select className="node-select" value={node} onChange={(e) => setNode(e.target.value)} aria-label="Filter by node">
              <option value="all">All nodes</option>
              {nodeOptions.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
          )}
          </div>
        </div>
      </div>

      <Card>
        {devs.loading && !devs.data ? <Loading />
          : devs.error && !devs.data ? <p className="msg-err">{devs.error.message}</p>
          : visible.length === 0 ? (
            <Empty message={rows.length === 0 ? 'No devices connected.' : 'No device matches the filter.'} />
          ) : (
          <div className="dev-cards">
            {visible.map((d) => (
              <div key={d.mac} className={'dev-card' + (d.paused ? ' paused' : '') + (!d.conn ? ' idle' : '')}>
                <div className="dev-card-top">
                  <span className="dev-icon" title={TYPE_LABEL[d.type]}>
                    {d.nodeName ? <Router size={20} /> : <DeviceIcon type={d.type} size={20} />}
                  </span>

                  {editing === d.mac ? (
                    <span className="name-edit">
                      <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus maxLength={40}
                             aria-label="Device name"
                             onKeyDown={(e) => { if (e.key === 'Enter') saveName(d.mac); if (e.key === 'Escape') setEditing(null); }} />
                      <button className="icon-btn ok" onClick={() => saveName(d.mac)} aria-label="Save"><Check size={16} /></button>
                      <button className="icon-btn" onClick={() => setEditing(null)} aria-label="Cancel"><X size={16} /></button>
                    </span>
                  ) : (
                    <span className="dev-name">
                      <span className={'dev-name-text' + (d.guessed ? ' guessed' : '')}
                            title={d.guessed ? 'The device does not send its name: this is a guess from the vendor. Tap the pencil to set one.' : undefined}>
                        {d.displayName}
                      </span>
                      <button className="icon-btn ghost" onClick={() => { setEditing(d.mac); setDraft(names[d.mac] || ''); }}
                              aria-label="Rename"><Pencil size={13} /></button>
                    </span>
                  )}

                  {d.paused ? <span className="pause-ind" title="Internet paused"><PauseCircle size={18} /></span>
                    : d.conn === 'cable' ? <span className="cable-ind" title="Wired connection"><Cable size={18} /></span>
                    : d.conn === 'wifi' ? <SignalBars dbm={d.signal} /> : null}
                </div>

                <div className="dev-card-meta mono">
                  {d.ipaddr} · {d.mac}
                  {d.hostname && d.hostname !== d.displayName && <> · <span title="Name the device sends">{d.hostname}</span></>}
                </div>

                <div className="dev-card-tags">
                  {d.nodeId ? <Badge tone="accent">{nodeLabel(d.nodeId, nodeNames)}</Badge>
                    : <Badge tone="muted">{d.absent ? 'Disconnected' : 'Idle'}</Badge>}
                  {d.conn === 'cable' ? <Badge tone="muted">Wired</Badge>
                    : d.band ? <Badge tone="muted">{d.band}</Badge> : null}
                  {!d.nodeName && <Badge tone="muted">{TYPE_LABEL[d.type]}</Badge>}
                  {!d.nodeName && d.vendor && !d.oem && !d.displayName.includes(d.vendor) && <Badge tone="muted">{d.vendor}</Badge>}
                  {!d.nodeName && d.oem && (
                    <span title="Maker of the WiFi module, not of the device"><Badge tone="muted">{d.vendor} module</Badge></span>
                  )}
                  {d.privateMac && (
                    <span title="The device uses a private (random) MAC for this network: its vendor cannot be known.">
                      <Badge tone="muted">Private MAC</Badge>
                    </span>
                  )}
                  {d.nodeName && <Badge tone="muted">Mesh node</Badge>}
                  {d.paused && <Badge tone="danger">Internet paused</Badge>}
                  {d.limited > 0 && <Badge tone="warning">{Math.round(d.limited / 1000)} Mbps</Badge>}
                  {d.reservedIp && <Badge tone="muted"><Pin size={11} /> Static IP</Badge>}
                  {d.noLease && (
                    <span title={'The DHCP lease table lives in memory and is cleared on reboot. The device kept its IP and has not asked for it again.'
                      + (d.nameSource === 'saved' ? ' The name is the one the router remembered from before.' : '')}>
                      <Badge tone="muted">No DHCP lease</Badge>
                    </span>
                  )}
                </div>

                {!d.nodeName && d.type === 'router' && d.vendor === 'Motorola' && (
                  <p className="hint dev-node-hint">Is it a Q11 Freedom node? <Link to="/mesh?add=1">Add it to the mesh</Link></p>
                )}
                {!d.nodeName && (
                  <div className="dev-card-actions">
                    {speedFor === d.mac ? (
                      <div className="speed-picker">
                        {SPEED_PRESETS.map((p) => (
                          <button key={p.kbit} className={'chip' + (d.limited === p.kbit ? ' on' : '')}
                                  disabled={busy === d.mac} onClick={() => applySpeed(d, p.kbit)}>{p.label}</button>
                        ))}
                        <button className="chip" onClick={() => setSpeedFor(null)} aria-label="Close"><X size={14} /></button>
                      </div>
                    ) : (
                      <>
                        <button className={'link-btn' + (d.paused ? ' resume' : ' danger')} onClick={() => togglePause(d)}
                                disabled={busy === d.mac}>
                          {d.paused ? <><PlayCircle size={14} /> Resume internet</> : <><PauseCircle size={14} /> Pause internet</>}
                        </button>
                        {!d.absent && isIp(d.ipaddr) && (
                          <button className="link-btn" onClick={() => setSpeedFor(d.mac)}>
                            <Gauge size={14} /> Speed limit
                          </button>
                        )}
                        {!d.absent && (
                          <button className="link-btn" onClick={() => setReserve({ mac: d.mac, ip: d.ipaddr, name: d.guessed ? '' : d.displayName, label: d.displayName })}>
                            <Pin size={14} /> {d.reservedIp ? `Static IP ${d.reservedIp}` : 'Reserve IP'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <p className="hint">
        "Pause internet" cuts the device's internet access across the whole mesh; it stays connected to the local network.
        The speed limit applies to downloads and survives reboots. The type and the gray names are a guess based on
        the vendor and the name the device sends; set your own name with the pencil.
      </p>

      <ReserveModal open={!!reserve} onClose={() => setReserve(null)} target={reserve}
                    lanIp={status.lan_ip} reserved={statics.data ?? []} onSaved={statics.refresh} />
    </div>
  );
}
