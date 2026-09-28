import { useState } from 'react';
import { Settings, KeyRound, Power, ScrollText, LogOut, Info } from 'lucide-react';
import { Card, Button, Field, Loading } from '../components/ui';
import { useToast, errMsg } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { useReboot } from '../components/Rebooting';
import { LogViewer } from '../components/LogViewer';
import { useAuth } from '../auth';
import { usePoll } from '../lib/usePoll';
import { getBoard, getSystemInfo } from '../lib/api';
import { rebootRouter, setPassword, getLog, getNodes, rebootNode, BAD_CHARS, SYNC_TEXT } from '../lib/meshApi';
import { fmtUptime, memPercent, loadAvg } from '../lib/format';
import { useNode, useStatus } from '../status';

export function System() {
  const s = useNode();
  const { refresh: refreshStatus } = useStatus();
  const { logout } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const reboot = useReboot();
  const board = usePoll(getBoard, 300_000);
  const info = usePoll(getSystemInfo, 10_000);

  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const pwErr = pw1 && pw1.length < 8 ? 'At least 8 characters.'
    : BAD_CHARS.test(pw1) ? 'Quotes, \\, $ and ` are not allowed.'
    : '';
  const matchErr = pw2 && pw1 !== pw2 ? 'The passwords do not match.' : '';

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw1 || pwErr || pw1 !== pw2) return;
    setBusy(true);
    try {
      const r = await setPassword(pw1);
      setPw1(''); setPw2('');
      const bad = (r.sync ?? []).filter((x) => x.result !== 'ok');
      if (bad.length) {
        toast.info(`Password changed. Not copied to: ${bad.map((b) => `${b.id} (${SYNC_TEXT[b.result] ?? b.result})`).join(', ')}. It will be copied on the next sync.`);
      } else {
        toast.ok(s.slaves > 0
          ? `Password changed on the master and on ${r.sync.length} node(s).`
          : 'Password changed. Use it the next time you sign in.');
      }
      refreshStatus();
    } catch (ex) { toast.err(errMsg(ex, 'Could not change the password.')); }
    finally { setBusy(false); }
  };

  const rebootSelf = async () => {
    const ok = await confirm({
      title: 'Reboot this node',
      message: <p>The master takes ~1 minute to come back. Meanwhile <strong>the whole mesh has no internet</strong>.</p>,
      confirmLabel: 'Reboot', danger: true,
    });
    if (!ok) return;
    try {
      await rebootRouter();
      reboot({ title: 'Rebooting the master', message: <p>Back in ~1 minute. Do not unplug the router.</p> });
    } catch (ex) { toast.err(errMsg(ex)); }
  };

  const rebootMesh = async () => {
    const ok = await confirm({
      title: 'Reboot the whole mesh',
      message: <>
        <p>The <strong>{s.slaves} node(s)</strong> reboot first, then the master. Every device loses its connection for ~1–2 minutes.</p>
      </>,
      confirmLabel: 'Reboot all', danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const nodes = await getNodes();
      const slaves = nodes.filter((n) => !n.self && n.online);
      const res = await Promise.allSettled(slaves.map((n) => rebootNode(n.id)));
      const failed = slaves.filter((_, i) => res[i].status === 'rejected').map((n) => n.id);
      await rebootRouter();
      reboot({
        title: 'Rebooting the mesh',
        message: <>
          <p>Waiting for the master to come back. The nodes reconnect by themselves.</p>
          {failed.length > 0 && <p>Did not respond: {failed.join(', ')}.</p>}
        </>,
      });
    } catch (ex) { toast.err(errMsg(ex)); }
    finally { setBusy(false); }
  };

  const sys = info.data;
  const b = board.data;

  return (
    <div className="page">
      <header className="page-head"><h1>System</h1></header>

      <Card title="This node" icon={<Settings size={18} />}>
        <div className="kv">
          <div><span>Hostname</span><b className="mono">{s.hostname}</b></div>
          <div><span>Role</span><b>{s.role === 'master' ? 'Master' : 'Slave'} · <span className="mono">{s.node_id}</span></b></div>
          <div><span>LAN IP</span><b className="mono">{s.lan_ip}</b></div>
          <div><span>MAC</span><b className="mono">{s.mac.toUpperCase()}</b></div>
          <div><span>Q11 Freedom version</span><b className="mono">{s.version}</b></div>
          {b ? <>
            <div><span>Model</span><b className="mono">{b.model}</b></div>
            <div><span>Firmware</span><b className="mono">{b.release.version}</b></div>
            <div><span>Kernel</span><b className="mono">{b.kernel}</b></div>
          </> : <Loading />}
          <div><span>Uptime</span><b className="mono">{fmtUptime(sys?.uptime ?? s.uptime)}</b></div>
          {sys && <>
            <div><span>Memory in use</span><b className="mono">{memPercent(sys.memory.total, sys.memory.available)}% · {Math.round(sys.memory.available / 1048576)} MB free</b></div>
            <div><span>Load (1 min)</span><b className="mono">{loadAvg(sys.load)}</b></div>
          </>}
        </div>
      </Card>

      <Card title="Admin password" icon={<KeyRound size={18} />}>
        <form onSubmit={changePw} className="form">
          {s.slaves > 0 ? (
            <p className="info-box"><Info size={15} />
              <span>The new password is copied to the {s.slaves} node(s) of the mesh: it signs you in to any of them.</span>
            </p>
          ) : !s.pw_changed && (
            <p className="warn-box">You are still using the factory password. Change it to one of your own.</p>
          )}
          <Field label="New password" htmlFor="pw1" error={pwErr}>
            <div className="pass-row">
              <input id="pw1" type={show ? 'text' : 'password'} value={pw1} onChange={(e) => setPw1(e.target.value)}
                     autoComplete="new-password" aria-invalid={!!pwErr} />
              <button type="button" className="pass-toggle" onClick={() => setShow((v) => !v)}>{show ? 'Hide' : 'Show'}</button>
            </div>
          </Field>
          <Field label="Repeat password" htmlFor="pw2" error={matchErr}>
            <input id="pw2" type={show ? 'text' : 'password'} value={pw2} onChange={(e) => setPw2(e.target.value)}
                   autoComplete="new-password" aria-invalid={!!matchErr} />
          </Field>
          <Button type="submit" disabled={busy || !pw1 || !!pwErr || pw1 !== pw2}>
            {busy ? 'Saving…' : 'Change password'}
          </Button>
        </form>
      </Card>

      <Card title="Logs" icon={<ScrollText size={18} />}>
        <p className="hint" style={{ marginTop: 0 }}>Last 150 lines of this node's system log. The slaves' logs are under Mesh.</p>
        <Button variant="ghost" onClick={() => setLogOpen(true)}><ScrollText size={16} /> View log</Button>
      </Card>

      <Card title="Power" icon={<Power size={18} />}>
        <div className="btn-row">
          <Button variant="danger" onClick={rebootSelf} disabled={busy}><Power size={16} /> Reboot this node</Button>
          {s.slaves > 0 && (
            <Button variant="ghost" onClick={rebootMesh} disabled={busy}><Power size={16} /> Reboot the whole mesh</Button>
          )}
        </div>
      </Card>

      <Button variant="ghost" onClick={() => logout()}><LogOut size={16} /> Sign out</Button>

      <LogViewer open={logOpen} onClose={() => setLogOpen(false)} title={`Log · ${s.hostname}`} load={getLog} />
    </div>
  );
}
