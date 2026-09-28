import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Smartphone, Wifi, Network, Settings, LogOut, Share2 } from 'lucide-react';
import { useAuth } from '../auth';
import { useNode } from '../status';
import { Logo } from './Logo';
import './Layout.css';

const NAV: { to: string; label: string; long?: string; icon: typeof Wifi; end?: boolean }[] = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/mesh', label: 'Mesh', icon: Share2 },
  { to: '/devices', label: 'Devices', icon: Smartphone },
  { to: '/wifi', label: 'WiFi', icon: Wifi },
  { to: '/network', label: 'Network', icon: Network },
  { to: '/system', label: 'System', icon: Settings },
];

export function Layout() {
  const { logout } = useAuth();
  const status = useNode();
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="side-brand">
          <Logo size={32} />
          <span>Q11 <strong>Freedom</strong></span>
        </div>
        <div className="side-node">
          <span className={'mesh-dot' + (status.internet ? '' : ' off')} />
          <span className="mono">{status.hostname}</span>
          <span className="dim">{status.lan_ip}</span>
        </div>
        <nav className="side-nav">
          {NAV.map(({ to, label, long, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
                     className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
              <Icon size={20} /> <span>{long ?? label}</span>
            </NavLink>
          ))}
        </nav>
        <button className="nav-item logout" onClick={() => logout()}>
          <LogOut size={20} /> <span>Sign out</span>
        </button>
      </aside>

      <main className="content">
        <Outlet />
      </main>

      <nav className="bottom-nav" aria-label="Sections">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}
                   className={({ isActive }) => 'bn-item' + (isActive ? ' active' : '')}>
            <Icon size={22} /> <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
