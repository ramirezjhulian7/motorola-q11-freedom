import { useState } from 'react';
import { Settings, KeyRound, Power, ScrollText, LogOut, Info, Languages } from 'lucide-react';
import { Card, Button, Field, Loading, Segmented } from '../components/ui';
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
import { t, lang, setLang, type Lang } from '../i18n';

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

  const pwErr = pw1 && pw1.length < 8 ? t('At least 8 characters.')
    : BAD_CHARS.test(pw1) ? t('Quotes, \\, $ and ` are not allowed.')
    : '';
  const matchErr = pw2 && pw1 !== pw2 ? t('The passwords do not match.') : '';

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw1 || pwErr || pw1 !== pw2) return;
    setBusy(true);
    try {
      const r = await setPassword(pw1);
      setPw1(''); setPw2('');
      const bad = (r.sync ?? []).filter((x) => x.result !== 'ok');
      if (bad.length) {
        toast.info(t('Password changed. Not copied to: {list}. It will be copied on the next sync.', {
          list: bad.map((b) => `${b.id} (${SYNC_TEXT[b.result] ?? b.result})`).join(', '),
        }));
      } else {
        toast.ok(s.slaves > 0
          ? t('Password changed on the master and on {n} node(s).', { n: r.sync.length })
          : t('Password changed. Use it the next time you sign in.'));
      }
      refreshStatus();
    } catch (ex) { toast.err(errMsg(ex, t('Could not change the password.'))); }
    finally { setBusy(false); }
  };

  const rebootSelf = async () => {
    const ok = await confirm({
      title: t('Reboot this node'),
      message: <p>{t('The master takes ~1 minute to come back. Meanwhile')} <strong>{t('the whole mesh has no internet')}</strong>.</p>,
      confirmLabel: t('Reboot'), danger: true,
    });
    if (!ok) return;
    try {
      await rebootRouter();
      reboot({ title: t('Rebooting the master'), message: <p>{t('Back in ~1 minute. Do not unplug the router.')}</p> });
    } catch (ex) { toast.err(errMsg(ex)); }
  };

  const rebootMesh = async () => {
    const [before, after] = t('The {nodes} reboot first, then the master. Every device loses its connection for ~1–2 minutes.').split('{nodes}');
    const ok = await confirm({
      title: t('Reboot the whole mesh'),
      message: <>
        <p>{before}<strong>{t('{n} node(s)', { n: s.slaves })}</strong>{after}</p>
      </>,
      confirmLabel: t('Reboot all'), danger: true,
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
        title: t('Rebooting the mesh'),
        message: <>
          <p>{t('Waiting for the master to come back. The nodes reconnect by themselves.')}</p>
          {failed.length > 0 && <p>{t('Did not respond: {list}.', { list: failed.join(', ') })}</p>}
        </>,
      });
    } catch (ex) { toast.err(errMsg(ex)); }
    finally { setBusy(false); }
  };

  const sys = info.data;
  const b = board.data;

  return (
    <div className="page">
      <header className="page-head"><h1>{t('System')}</h1></header>

      <Card title={t('This node')} icon={<Settings size={18} />}>
        <div className="kv">
          <div><span>{t('Hostname')}</span><b className="mono">{s.hostname}</b></div>
          <div><span>{t('Role')}</span><b>{s.role === 'master' ? t('Master') : t('Slave')} · <span className="mono">{s.node_id}</span></b></div>
          <div><span>{t('LAN IP')}</span><b className="mono">{s.lan_ip}</b></div>
          <div><span>MAC</span><b className="mono">{s.mac.toUpperCase()}</b></div>
          <div><span>{t('Q11 Freedom version')}</span><b className="mono">{s.version}</b></div>
          {b ? <>
            <div><span>{t('Model')}</span><b className="mono">{b.model}</b></div>
            <div><span>Firmware</span><b className="mono">{b.release.version}</b></div>
            <div><span>Kernel</span><b className="mono">{b.kernel}</b></div>
          </> : board.error ? <p className="msg-err">{board.error.message}</p> : <Loading />}
          <div><span>{t('Uptime')}</span><b className="mono">{fmtUptime(sys?.uptime ?? s.uptime)}</b></div>
          {sys && <>
            <div><span>{t('Memory in use')}</span><b className="mono">{memPercent(sys.memory.total, sys.memory.available)}% · {t('{n} MB free', { n: Math.round(sys.memory.available / 1048576) })}</b></div>
            <div><span>{t('Load (1 min)')}</span><b className="mono">{loadAvg(sys.load)}</b></div>
          </>}
        </div>
      </Card>

      <Card title={t('Language')} icon={<Languages size={18} />}>
        <Segmented<Lang> label={t('Language')} value={lang} onChange={setLang} options={[
          { value: 'en', label: 'English' },
          { value: 'es', label: 'Español' },
        ]} />
      </Card>

      <Card title={t('Admin password')} icon={<KeyRound size={18} />}>
        <form onSubmit={changePw} className="form">
          {s.slaves > 0 ? (
            <p className="info-box"><Info size={15} />
              <span>{t('The new password is copied to the {n} node(s) of the mesh: it signs you in to any of them.', { n: s.slaves })}</span>
            </p>
          ) : !s.pw_changed && (
            <p className="warn-box">{t('You are still using the factory password. Change it to one of your own.')}</p>
          )}
          <Field label={t('New password')} htmlFor="pw1" error={pwErr}>
            <div className="pass-row">
              <input id="pw1" type={show ? 'text' : 'password'} value={pw1} onChange={(e) => setPw1(e.target.value)}
                     autoComplete="new-password" aria-invalid={!!pwErr} />
              <button type="button" className="pass-toggle" onClick={() => setShow((v) => !v)}>{show ? t('Hide') : t('Show')}</button>
            </div>
          </Field>
          <Field label={t('Repeat password')} htmlFor="pw2" error={matchErr}>
            <input id="pw2" type={show ? 'text' : 'password'} value={pw2} onChange={(e) => setPw2(e.target.value)}
                   autoComplete="new-password" aria-invalid={!!matchErr} />
          </Field>
          <Button type="submit" disabled={busy || !pw1 || !!pwErr || pw1 !== pw2}>
            {busy ? t('Saving…') : t('Change password')}
          </Button>
        </form>
      </Card>

      <Card title={t('Logs')} icon={<ScrollText size={18} />}>
        <p className="hint" style={{ marginTop: 0 }}>{t("Last 150 lines of this node's system log. The slaves' logs are under Mesh.")}</p>
        <Button variant="ghost" onClick={() => setLogOpen(true)}><ScrollText size={16} /> {t('View log')}</Button>
      </Card>

      <Card title={t('Power')} icon={<Power size={18} />}>
        <div className="btn-row">
          <Button variant="danger" onClick={rebootSelf} disabled={busy}><Power size={16} /> {t('Reboot this node')}</Button>
          {s.slaves > 0 && (
            <Button variant="ghost" onClick={rebootMesh} disabled={busy}><Power size={16} /> {t('Reboot the whole mesh')}</Button>
          )}
        </div>
      </Card>

      <Button variant="ghost" onClick={() => logout()}><LogOut size={16} /> {t('Sign out')}</Button>

      <LogViewer open={logOpen} onClose={() => setLogOpen(false)} title={t('Log · {host}', { host: s.hostname })} load={getLog} />
    </div>
  );
}
