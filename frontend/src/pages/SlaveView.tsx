import { ExternalLink, LogOut, Cable, Globe, Wifi, Clock, RefreshCw } from 'lucide-react';
import { useAuth } from '../auth';
import { useNode } from '../status';
import { Logo } from '../components/Logo';
import { Badge } from '../components/ui';
import { fmtUptime, fmtAgo } from '../lib/format';
import { t } from '../i18n';
import './Login.css';

/**
 * A slave is administered from the master only (docs/API.md): here we just
 * say what this node is and link to the master's panel.
 */
export function SlaveView() {
  const { logout } = useAuth();
  const s = useNode();
  const masterUrl = s.master_ip ? `${location.protocol}//${s.master_ip}/app/` : '';

  return (
    <div className="login-wrap">
      <div className="login-card slave-card">
        <div className="login-brand">
          <Logo size={48} />
          <h1>Q11 <span>Freedom</span></h1>
          <p>{t('This router is a')} <strong>{t('slave node')}</strong> {t('of the mesh')}</p>
        </div>

        <div className="kv">
          <div><span>{t('Node')}</span><b className="mono">{s.node_id} · {s.lan_ip}</b></div>
          <div><span><Globe size={13} /> {t('Internet')}</span>
            <Badge tone={s.internet ? 'accent' : 'danger'}>{s.internet ? t('Connected') : t('No internet')}</Badge></div>
          <div><span><Wifi size={13} /> {t('WiFi network')}</span><b>{s.ssid || '—'}</b></div>
          <div><span><Clock size={13} /> {t('Uptime')}</span><b className="mono">{fmtUptime(s.uptime)}</b></div>
          <div><span><RefreshCw size={13} /> {t('Last sync')}</span><b>{fmtAgo(s.last_sync)}</b></div>
          <div><span><Cable size={13} /> {t('Master')}</span><b className="mono">{s.master_ip || t('not assigned')}</b></div>
        </div>

        <p className="hint slave-note">
          {t('The WiFi network, the password and the devices are managed from the master; this node receives the changes automatically.')}
        </p>

        {masterUrl ? (
          <a className="btn btn-primary" href={masterUrl}>
            <ExternalLink size={16} /> {t('Go to the master\'s panel')}
          </a>
        ) : (
          <p className="warn-box">{t('This node does not know its master yet. Add it from the master\'s Mesh section.')}</p>
        )}
        <button className="btn btn-ghost" onClick={() => logout()}><LogOut size={16} /> {t('Sign out')}</button>
      </div>
    </div>
  );
}
