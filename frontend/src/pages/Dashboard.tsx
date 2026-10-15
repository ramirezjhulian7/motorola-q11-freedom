import { Link } from 'react-router-dom';
import {
  Globe, Wifi, Share2, Smartphone, KeyRound, PenLine, Plus, CheckCircle2, Circle, ChevronRight, Clock,
} from 'lucide-react';
import { Card, Stat, Badge, Loading } from '../components/ui';
import { usePoll } from '../lib/usePoll';
import { getDevicesByNode, clientsByNode } from '../lib/api';
import { getNodes, getFreedomConfig, getIsp, ispBrand } from '../lib/meshApi';
import { nodeLabel } from '../lib/nodes';
import { fmtUptime } from '../lib/format';
import { useNode } from '../status';
import { t } from '../i18n';
import './Dashboard.css';

const WAN_LABEL: Record<string, string> = { dhcp: t('Automatic (DHCP)'), static: t('Static IP'), pppoe: 'PPPoE' };

export function Dashboard() {
  const s = useNode();
  const nodes = usePoll(getNodes, 20_000);
  const devices = usePoll(getDevicesByNode, 20_000);
  const cfg = usePoll(getFreedomConfig, 60_000);
  const isp = usePoll(() => getIsp(), 3_600_000);   // the router caches it 6 h
  const names = cfg.data?.nodeNames ?? {};

  const list = nodes.data ?? [];
  const online = list.filter((n) => n.online).length;
  const connected = (devices.data ?? []).filter((d) => d.conn);
  const nodeMacs = list.map((n) => n.mac ?? '').filter(Boolean);
  const perNode = clientsByNode(devices.data ?? [], nodeMacs);
  const clients = connected.filter((d) => !nodeMacs.some((m) => m.toUpperCase() === d.mac));
  const wifi = clients.filter((d) => d.conn === 'wifi').length;

  const steps = [
    { done: s.pw_changed, icon: KeyRound, to: '/system',
      title: t('Change the admin password'),
      text: t('It is still the factory one. It is copied to every node.') },
    { done: !/^mh7601/i.test(s.ssid), icon: PenLine, to: '/wifi',
      title: t('Name your WiFi network'),
      text: t('It is still called "{ssid}", the factory name.', { ssid: s.ssid }) },
    { done: s.slaves > 0, icon: Plus, to: '/mesh?add=1',
      title: t('Add your first node'),
      text: t('Wire it to the master to extend coverage.') },
  ];
  const pending = steps.filter((x) => !x.done).length;

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t('Home')}</h1>
        <Badge tone="accent">{s.hostname}</Badge>
      </header>

      <section className={'net-hero' + (s.internet ? '' : ' down')} aria-live="polite">
        <span className="net-hero-ico"><Globe size={28} /></span>
        <div className="net-hero-main">
          <strong>
            {s.internet ? t('Connected to the internet') : t('No internet')}
            {isp.data && <> · <span className="isp-brand">{ispBrand(isp.data)}</span></>}
          </strong>
          {isp.data && (
            <span title={`${isp.data.org} · AS${isp.data.asn}`}>
              <span className="hide-sm">{t('Provider {org}', { org: isp.data.org })} · </span>{t('Public IP')} <span className="mono">{isp.data.public_ip}</span>
            </span>
          )}
          <span>
            WAN {WAN_LABEL[s.wan_proto] ?? s.wan_proto ?? '—'} · <span className="mono">{s.wan_ip || t('no IP')}</span>
          </span>
          {!s.internet && (
            <span className="net-hero-help">
              {t("Check the cable from the modem to the master's WAN port, or the")} <Link to="/network">{t('WAN settings')}</Link>.
            </span>
          )}
        </div>
        <span className="net-hero-up"><Clock size={14} /> {fmtUptime(s.uptime)}</span>
      </section>

      {pending > 0 && (
        <Card title={t('Getting started')} actions={<span className="dim">{t('{done} of {total} done', { done: steps.length - pending, total: steps.length })}</span>}>
          <ol className="steps">
            {steps.map(({ done, icon: Icon, to, title, text }) => (
              <li key={title} className={done ? 'done' : ''}>
                {done ? (
                  <div className="step">
                    <CheckCircle2 size={20} className="step-check" />
                    <div><strong>{title}</strong></div>
                  </div>
                ) : (
                  <Link to={to} className="step">
                    <Circle size={20} className="step-check" />
                    <div><strong>{title}</strong><span>{text}</span></div>
                    <Icon size={18} className="step-ico" />
                    <ChevronRight size={18} />
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div className="grid grid-3">
        <Link to="/wifi" className="card-link">
          <Card title={t('WiFi network')} icon={<Wifi size={18} />}>
            <Stat label={t('Name')} value={<span className="ssid">{s.ssid || '—'}</span>} sub="2.4 GHz + 5 GHz" />
          </Card>
        </Link>
        <Link to="/mesh" className="card-link">
          <Card title={t('Nodes')} icon={<Share2 size={18} />}>
            {nodes.data ? (
              <Stat label={t('Online')} value={`${online}/${list.length}`} accent={online === list.length}
                    sub={list.length > 1 ? t('wired together') : t('master only')} />
            ) : <Loading />}
          </Card>
        </Link>
        <Link to="/devices" className="card-link">
          <Card title={t('Devices')} icon={<Smartphone size={18} />}>
            {devices.data ? (
              <Stat label={t('Connected now')} value={clients.length} accent
                    sub={t('{wifi} on WiFi · {wired} wired', { wifi, wired: clients.length - wifi })} />
            ) : devices.error ? <p className="msg-err">{devices.error.message}</p> : <Loading />}
          </Card>
        </Link>
      </div>

      {list.length > 0 && (
        <Card title={t('Mesh')} icon={<Share2 size={18} />} actions={<Link to="/mesh" className="dim">{t('Manage')}</Link>}>
          <div className="mesh-list">
            {list.map((n) => (
              <div key={n.id} className="mesh-node">
                <span className={'mesh-dot' + (n.online ? '' : ' off')} />
                <span className="mesh-name">{nodeLabel(n.id, names)}</span>
                {n.online && <span className="dim">{t('{wifi} WiFi · {wired} wired', { wifi: n.clients ?? 0, wired: perNode[n.id]?.cable ?? 0 })}</span>}
                <span className="mono mesh-ip">{n.ip}</span>
                <Badge tone={n.online ? 'accent' : 'danger'}>{n.online ? t('Online') : t('Offline')}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="fw-note mono">Q11 Freedom {s.version} · {s.node_id} · {s.lan_ip}</p>
    </div>
  );
}
