import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, RefreshCw, Pencil, Check, X, Power, ScrollText, Trash2, Router, Cable,
  Clock, Users, Globe, AlertTriangle, Wifi,
} from 'lucide-react';
import { Card, Badge, Button, Loading } from '../components/ui';
import { useToast, errMsg } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { useReboot } from '../components/Rebooting';
import { LogViewer } from '../components/LogViewer';
import { AddNodeWizard } from '../components/AddNodeWizard';
import { usePoll } from '../lib/usePoll';
import { getDevicesByNode, clientsByNode } from '../lib/api';
import {
  getNodes, getFreedomConfig, setNodeName, syncNodes, rebootNode, rebootRouter,
  removeNode, getNodeLog, getLog, BAD_CHARS, SYNC_TEXT, type MeshNodeInfo,
} from '../lib/meshApi';
import { nodeLabel } from '../lib/nodes';
import { fmtUptime, fmtAgo } from '../lib/format';
import { useNode, useStatus } from '../status';
import './Mesh.css';

export function Mesh() {
  const status = useNode();
  const { refresh: refreshStatus } = useStatus();
  const toast = useToast();
  const confirm = useConfirm();
  const reboot = useReboot();
  const [params, setParams] = useSearchParams();

  const nodes = usePoll(getNodes, 15_000);
  const cfg = usePoll(getFreedomConfig, 30_000);
  const names = cfg.data?.nodeNames ?? {};
  const list = nodes.data ?? [];
  const master = list.find((n) => n.self);
  const slaves = list.filter((n) => !n.self);
  const online = list.filter((n) => n.online).length;
  const devs = usePoll(getDevicesByNode, 15_000);
  const perNode = clientsByNode(devs.data ?? [], list.map((n) => n.mac ?? '').filter(Boolean));
  // WiFi from the node itself (wl assoclist); cable from the mesh client list
  const counts = (n: MeshNodeInfo) => ({ wifi: n.clients ?? 0, cable: perNode[n.id]?.cable ?? 0 });

  const [adding, setAdding] = useState(params.get('add') === '1');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null); // "<action>:<id>"
  const [log, setLog] = useState<MeshNodeInfo | null>(null);

  const label = (id: string) => nodeLabel(id, names);
  const refresh = () => { nodes.refresh(); cfg.refresh(); refreshStatus(); };

  const closeWizard = (added?: boolean) => {
    setAdding(false);
    if (params.has('add')) setParams({}, { replace: true });
    if (added) refresh();
  };

  const saveName = async (id: string) => {
    const name = draft.trim();
    if (BAD_CHARS.test(name)) return toast.err('The name cannot contain quotes, \\, $ or `.');
    try {
      await setNodeName(id, name);
      setEditing(null);
      cfg.refresh();
      toast.ok(name ? `Node renamed to "${name}".` : 'The node name was removed.');
    } catch (e) { toast.err(errMsg(e)); }
  };

  const doSync = async (only?: string) => {
    setBusy(`sync:${only ?? 'all'}`);
    try {
      const res = await syncNodes();
      const mine = only ? res.filter((r) => r.id === only) : res;
      if (!mine.length) toast.info('There are no nodes to sync.');
      else if (mine.every((r) => r.result === 'ok')) {
        toast.ok(only ? `${label(only)}: synced.` : `${mine.length} node(s) synced.`);
      } else {
        const bad = mine.filter((r) => r.result !== 'ok');
        const text = bad.map((r) => `${label(r.id)} ${SYNC_TEXT[r.result] ?? r.result}`).join(' · ');
        (bad.some((r) => r.result === 'offline' || r.result === 'error') ? toast.err : toast.info)(text);
      }
      nodes.refresh();
    } catch (e) { toast.err(errMsg(e)); }
    finally { setBusy(null); }
  };

  const doReboot = async (n: MeshNodeInfo) => {
    if (n.self) {
      const ok = await confirm({
        title: 'Reboot the master',
        message: <>
          <p>The master takes ~1 minute to come back. Meanwhile <strong>the whole mesh has no internet</strong>.</p>
          {slaves.length > 0 && <p>The slaves stay on and get internet back when it returns.</p>}
        </>,
        confirmLabel: 'Reboot', danger: true,
      });
      if (!ok) return;
      try {
        await rebootRouter();
        reboot({ title: 'Rebooting the master', message: <p>The mesh will have internet again in ~1 minute.</p> });
      } catch (e) { toast.err(errMsg(e)); }
      return;
    }
    const ok = await confirm({
      title: `Reboot ${label(n.id)}`,
      message: <p>Devices connected to this node will move to another node or drop off for ~1 minute.</p>,
      confirmLabel: 'Reboot', danger: true,
    });
    if (!ok) return;
    setBusy(`reboot:${n.id}`);
    try {
      await rebootNode(n.id);
      toast.ok(`${label(n.id)} is rebooting. It will be back in ~1 minute.`);
      setTimeout(nodes.refresh, 5000);
    } catch (e) { toast.err(errMsg(e)); }
    finally { setBusy(null); }
  };

  const doRemove = async (n: MeshNodeInfo) => {
    const ok = await confirm({
      title: `Remove ${label(n.id)} from the mesh`,
      message: <>
        <p>The master will stop managing and syncing it. The router is not wiped: it keeps its current settings.</p>
        <p>To use it again, add it back with its password.</p>
      </>,
      confirmLabel: 'Remove node', danger: true,
    });
    if (!ok) return;
    setBusy(`remove:${n.id}`);
    try {
      await removeNode(n.id);
      toast.ok(`${label(n.id)} is no longer part of the mesh.`);
      refresh();
    } catch (e) { toast.err(errMsg(e)); }
    finally { setBusy(null); }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Mesh</h1>
        <div className="head-actions">
          {slaves.length > 0 && (
            <Button variant="ghost" onClick={() => doSync()} disabled={!!busy}>
              <RefreshCw size={16} className={busy === 'sync:all' ? 'spin' : ''} /> Sync all
            </Button>
          )}
          <Button onClick={() => setAdding(true)}><Plus size={16} /> Add node</Button>
        </div>
      </header>
      {nodes.data && (
        <p className="page-sub">{online} of {list.length} node(s) online · all wired to the master</p>
      )}

      {nodes.loading && !nodes.data ? <Card><Loading /></Card>
        : nodes.error && !nodes.data ? <Card><p className="msg-err">{nodes.error.message}</p></Card>
        : (
        <>
          <Card title="Topology" icon={<Cable size={18} />}>
            <div className="topo">
              {master && <TopoNode n={master} name={label(master.id)} c={counts(master)} />}
              <ul className="topo-kids">
                {slaves.map((n) => <li key={n.id}><TopoNode n={n} name={label(n.id)} c={counts(n)} /></li>)}
                {slaves.length === 0 && (
                  <li>
                    <button className="topo-node topo-add" onClick={() => setAdding(true)}>
                      <Plus size={18} /> <span>Add the first node</span>
                    </button>
                  </li>
                )}
              </ul>
            </div>
          </Card>

          <div className="node-list">
            {list.map((n) => {
              const isBusy = (a: string) => busy === `${a}:${n.id}`;
              const outdated = !n.self && n.online && master?.version && n.version && n.version !== master.version;
              return (
                <Card key={n.id}>
                  <div className={'node-card' + (n.online ? '' : ' offline')}>
                    <div className="node-top">
                      <span className={'node-ico' + (n.self ? ' master' : '')}><Router size={20} /></span>
                      {editing === n.id ? (
                        <span className="name-edit">
                          <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus maxLength={40}
                                 aria-label="Node name" placeholder={n.self ? 'Master' : 'e.g. Bedroom'}
                                 onKeyDown={(e) => { if (e.key === 'Enter') saveName(n.id); if (e.key === 'Escape') setEditing(null); }} />
                          <button className="icon-btn ok" onClick={() => saveName(n.id)} aria-label="Save"><Check size={16} /></button>
                          <button className="icon-btn" onClick={() => setEditing(null)} aria-label="Cancel"><X size={16} /></button>
                        </span>
                      ) : (
                        <div className="node-title">
                          <strong>{label(n.id)}</strong>
                          <span className="mono dim">{n.id} · {n.ip}</span>
                        </div>
                      )}
                      <div className="node-badges">
                        {n.self && <Badge tone="accent">Master</Badge>}
                        <Badge tone={n.online ? 'accent' : 'danger'}>{n.online ? 'Online' : 'Offline'}</Badge>
                        {!n.self && n.online && (
                          <Badge tone={n.synced ? 'muted' : 'warning'}>{n.synced ? 'Synced' : 'Not synced'}</Badge>
                        )}
                      </div>
                    </div>

                    {n.online ? (
                      <div className="node-stats">
                        <div><Clock size={14} /><span>Uptime</span><b className="mono">{fmtUptime(n.uptime ?? 0)}</b></div>
                        <div><Users size={14} /><span>Clients</span>
                          <b className="mono">{counts(n).wifi} WiFi · {devs.data ? counts(n).cable : '…'} wired</b></div>
                        <div><Globe size={14} /><span>Internet</span><b className={n.internet ? 'ok' : 'bad'}>{n.internet ? 'Yes' : 'No'}</b></div>
                        <div><RefreshCw size={14} /><span>Synced</span><b>{n.self ? '—' : fmtAgo(n.last_sync)}</b></div>
                      </div>
                    ) : (
                      <p className="warn-box"><AlertTriangle size={15} />
                        Not responding. Check that it is powered on and wired to the master.
                      </p>
                    )}
                    {outdated && (
                      <p className="warn-box"><AlertTriangle size={15} />
                        Version {n.version} (the master has {master!.version}). Update it with deploy-router-files.sh.
                      </p>
                    )}
                    {!n.self && n.online && !n.synced && (
                      <p className="hint">This node's WiFi network or password does not match the master. Use "Sync".</p>
                    )}

                    <div className="node-actions">
                      <button className="link-btn" onClick={() => { setEditing(n.id); setDraft(names[n.id] || ''); }}>
                        <Pencil size={14} /> Rename
                      </button>
                      {!n.self && (
                        <button className="link-btn" onClick={() => doSync(n.id)} disabled={!!busy}>
                          <RefreshCw size={14} className={isBusy('sync') ? 'spin' : ''} /> Sync
                        </button>
                      )}
                      <button className="link-btn" onClick={() => setLog(n)} disabled={!n.online}>
                        <ScrollText size={14} /> Log
                      </button>
                      <button className="link-btn danger" onClick={() => doReboot(n)} disabled={!n.online || !!busy}>
                        <Power size={14} /> Reboot
                      </button>
                      {!n.self && (
                        <button className="link-btn danger" onClick={() => doRemove(n)} disabled={!!busy}>
                          <Trash2 size={14} /> Remove
                        </button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <p className="hint">
        The master copies the network name, the WiFi password and the admin password to every node.
        Channels are not copied: each node picks its own.
      </p>

      <AddNodeWizard open={adding} onClose={closeWizard} masterIp={status.lan_ip}
                     knownIps={list.map((n) => n.ip)} />
      <LogViewer open={!!log} onClose={() => setLog(null)}
                 title={log ? `Log · ${label(log.id)}` : ''}
                 load={() => (log?.self ? getLog() : getNodeLog(log!.id))} />
    </div>
  );
}

function TopoNode({ n, name, c }: { n: MeshNodeInfo; name: string; c: { wifi: number; cable: number } }) {
  return (
    <div className={'topo-node' + (n.self ? ' master' : '') + (n.online ? '' : ' off')}>
      <span className={'mesh-dot' + (n.online ? '' : ' off')} />
      <div>
        <strong>{name}</strong>
        <span className="mono">{n.ip}</span>
      </div>
      {n.online && (
        <span className="topo-count" title={`${c.wifi} on WiFi · ${c.cable} wired`}>
          <Wifi size={12} /> {c.wifi} <Cable size={12} /> {c.cable}
        </span>
      )}
    </div>
  );
}
