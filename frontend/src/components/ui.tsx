import type { ReactNode } from 'react';
import { Smartphone, Monitor, Gamepad2, Tv, Cpu, Router, HelpCircle, Camera, Printer } from 'lucide-react';
import type { DeviceType } from '../lib/deviceType';
import './ui.css';

const TYPE_ICON: Record<DeviceType, typeof Smartphone> = {
  phone: Smartphone, computer: Monitor, console: Gamepad2,
  tv: Tv, iot: Cpu, camera: Camera, printer: Printer, router: Router, unknown: HelpCircle,
};

export function DeviceIcon({ type, size = 16 }: { type: DeviceType; size?: number }) {
  const Icon = TYPE_ICON[type];
  return <Icon size={size} />;
}

export function Card({ title, icon, children, actions }: {
  title?: string; icon?: ReactNode; children: ReactNode; actions?: ReactNode;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          <h2 className="card-title">{icon}{title}</h2>
          {actions}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, accent }: {
  label: string; value: ReactNode; sub?: string; accent?: boolean;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={'stat-value' + (accent ? ' accent' : '')}>{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export function Button({ children, variant = 'primary', ...rest }: {
  children: ReactNode; variant?: 'primary' | 'ghost' | 'danger';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`btn btn-${variant}`} {...rest}>{children}</button>;
}

export function Badge({ children, tone = 'muted' }: {
  children: ReactNode; tone?: 'accent' | 'muted' | 'warning' | 'danger';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function SignalBars({ dbm }: { dbm: number | null }) {
  // -50 great .. -90 poor
  const lvl = dbm == null ? 0 : dbm >= -55 ? 4 : dbm >= -67 ? 3 : dbm >= -78 ? 2 : 1;
  return (
    <span className="signal" title={dbm == null ? 'no data' : `${dbm} dBm`} aria-label={dbm == null ? 'no signal' : `${dbm} dBm`}>
      {[1, 2, 3, 4].map((i) => (
        <i key={i} className={'sig-bar' + (i <= lvl ? ' on' : '')} style={{ height: 4 + i * 3 }} />
      ))}
    </span>
  );
}

export function Empty({ message }: { message: string }) {
  return <div className="empty">{message}</div>;
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="loading" />;
}

export function Loading() {
  return <div className="loading"><Spinner /></div>;
}

/** Label + control + optional hint / inline error. */
export function Field({ label, htmlFor, hint, error, children }: {
  label: ReactNode; htmlFor?: string; hint?: ReactNode; error?: string | null; children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <p className="field-err" role="alert">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

/** Pill group for a single choice (radio semantics). */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
                className={'seg-item' + (value === o.value ? ' on' : '')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
