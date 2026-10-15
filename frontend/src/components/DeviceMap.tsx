import { Globe, Router, Cable, Wifi, PauseCircle } from 'lucide-react';
import { DeviceIcon, SignalBars } from './ui';
import type { DeviceType } from '../lib/deviceType';
import type { MeshNodeInfo } from '../lib/meshApi';
import './DeviceMap.css';

export interface MapDevice {
  mac: string;
  displayName: string;
  guessed: boolean;
  type: DeviceType;
  conn: 'wifi' | 'cable' | null;
  band: '2.4G' | '5G' | 'cable' | null;
  signal: number | null;
  nodeId: string | null;
  nodeName: string | null;   // the MAC is a mesh node itself: drawn as a node, not a leaf
  paused: boolean;
}

// cls drives the line style: solid green = cable, animated dashes = WiFi
const GROUPS: { key: string; cls: string; label: string; how: string; icon: typeof Wifi; match: (d: MapDevice) => boolean }[] = [
  { key: 'cable', cls: 'g-cable', label: 'Cable', how: 'by cable', icon: Cable, match: (d) => d.conn === 'cable' },
  { key: '5G', cls: 'g-5', label: 'WiFi 5 GHz', how: 'over WiFi 5 GHz', icon: Wifi, match: (d) => d.conn === 'wifi' && d.band === '5G' },
  { key: '2.4G', cls: 'g-24', label: 'WiFi 2.4 GHz', how: 'over WiFi 2.4 GHz', icon: Wifi, match: (d) => d.conn === 'wifi' && d.band !== '5G' },
];

const quality = (dbm: number | null) =>
  dbm == null ? '' : dbm >= -55 ? 'excellent' : dbm >= -67 ? 'good' : dbm >= -78 ? 'fair' : 'weak';

/**
 * Map of connected devices: internet → master → one column per node (the
 * master's own clients first), each with its devices grouped by connection.
 * Same visual language as the mesh topology; the backhaul is always cable.
 */
export function DeviceMap({ devices, nodes, label, isp, onPick }: {
  devices: MapDevice[];
  nodes: MeshNodeInfo[];
  label: (id: string) => string;
  isp: string | null;
  onPick: (mac: string) => void;
}) {
  const master = nodes.find((n) => n.self);
  const leaves = devices.filter((d) => d.nodeId && d.conn && !d.nodeName);
  const offline = devices.filter((d) => !d.conn && !d.nodeName).length;
  const byNode = (id: string) => leaves.filter((d) => d.nodeId === id);
  const columns = [
    ...(master ? [{ node: master, title: 'Direct to the master' }] : []),
    ...nodes.filter((n) => !n.self).map((n) => ({ node: n, title: label(n.id) })),
  ];

  return (
    <div className="dmap">
      <div className="dmap-legend" aria-label="Legend">
        <span><i className="lg-line g-cable" /> Cable</span>
        <span><i className="lg-line g-5" /> WiFi 5 GHz</span>
        <span><i className="lg-line g-24" /> WiFi 2.4 GHz</span>
      </div>
      <div className="dmap-root">
        <div className="dmap-internet"><Globe size={18} /> Internet{isp && <b>{isp}</b>}</div>
        <span className="dmap-v" aria-hidden="true" />
        {master && (
          <div className="dmap-master">
            <Router size={18} />
            <div><strong>{label(master.id)}</strong><span className="mono">{master.ip}</span></div>
            <span className="dmap-count">{leaves.length} devices</span>
          </div>
        )}
        {columns.length > 1 && <span className="dmap-backhaul"><Cable size={11} /> wired backhaul</span>}
      </div>

      <ul className="dmap-cols">
        {columns.map(({ node, title }) => {
          const list = byNode(node.id);
          const nCable = list.filter((d) => d.conn === 'cable').length;
          return (
            <li key={node.id} className={'dmap-col' + (node.online ? '' : ' off')}>
              <div className={'dmap-node' + (node.self ? ' self' : '')}>
                <span className={'mesh-dot' + (node.online ? '' : ' off')} />
                <div>
                  <strong>{title}</strong>
                  <span className="mono">{node.self ? 'Master WiFi and ports' : node.ip}</span>
                </div>
                {node.online ? (
                  <span className="dmap-split" title={`${nCable} wired · ${list.length - nCable} on WiFi`}>
                    <span className="c"><Cable size={12} /> {nCable}</span>
                    <span className="w"><Wifi size={12} /> {list.length - nCable}</span>
                  </span>
                ) : <span className="dmap-count">offline</span>}
              </div>
              {list.length === 0 ? (
                <p className="dmap-empty">{node.online ? 'No devices' : 'The node does not respond'}</p>
              ) : GROUPS.map((g) => {
                const items = list.filter(g.match);
                if (!items.length) return null;
                return (
                  <div key={g.key} className={'dmap-group ' + g.cls}>
                    <span className="dmap-group-head"><g.icon size={12} /> {g.label} · {items.length}</span>
                    <div className="dmap-leaves">
                      {items.map((d) => (
                        <button key={d.mac} className={'dmap-leaf' + (d.paused ? ' paused' : '')}
                                onClick={() => onPick(d.mac)}
                                title={`${d.displayName} · connected to ${title === 'Direct to the master' ? label(node.id) : title} ${g.how}`
                                  + (d.signal != null ? ` · signal ${quality(d.signal)} (${d.signal} dBm)` : '')
                                  + (d.paused ? ' · internet paused' : '')}>
                          <span className="dmap-ico"><DeviceIcon type={d.type} size={15} /></span>
                          <span className={'dmap-name' + (d.guessed ? ' guessed' : '')}>{d.displayName}</span>
                          {d.paused ? <PauseCircle size={14} className="dmap-paused" />
                            : d.conn === 'wifi' ? <SignalBars dbm={d.signal} /> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>
      {offline > 0 && <p className="hint dmap-note">{offline} offline device(s) are not shown on the map.</p>}
    </div>
  );
}
