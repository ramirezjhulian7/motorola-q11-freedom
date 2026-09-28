import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { RotateCw, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { useAuth } from '../auth';
import { Logo } from './Logo';
import { Button } from './ui';
import './feedback.css';

/**
 * Full-screen "rebooting" state. Every WiFi change, reboot or mesh-wide
 * reboot ends here: we wait until the node stops answering, then until it
 * answers again, and send the user to the login (ubus sessions live in RAM,
 * so the old token is dead after a reboot).
 *
 * `manual` is for changes where this page can't follow the node (new LAN IP):
 * no polling, just instructions and a link.
 */
interface RebootOpts {
  title: string;
  message?: ReactNode;
  manual?: { href: string; label: string };
}

type Phase = 'down' | 'up' | 'back' | 'slow';
const Ctx = createContext<(o: RebootOpts) => void>(null!);

const EXPECTED_S = 75;          // typical Q11 reboot
const NO_DROP_S = 45;           // never saw it go down -> assume it already came back
const SLOW_S = 300;

async function probe(): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 3500);
  try {
    // Any HTTP answer (a 401 included) means uhttpd is back.
    await fetch('/cgi-bin/freedom-api.sh', { method: 'POST', body: '{}', cache: 'no-store', signal: ctl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export function RebootProvider({ children }: { children: ReactNode }) {
  const { logout, setQuiet } = useAuth();
  const [opts, setOpts] = useState<RebootOpts | null>(null);
  const [phase, setPhase] = useState<Phase>('down');
  const [elapsed, setElapsed] = useState(0);
  const run = useRef(0);

  const start = useCallback((o: RebootOpts) => {
    run.current++;
    setQuiet(true);          // background polls will 401: no "session expired" toast
    setPhase('down');
    setElapsed(0);
    setOpts(o);
  }, [setQuiet]);

  const finish = useCallback((msg?: string) => {
    run.current++;
    setOpts(null);
    logout(msg);
    setQuiet(false);
  }, [logout, setQuiet]);

  useEffect(() => {
    if (!opts || opts.manual) return;
    const my = run.current;
    const t0 = Date.now();
    let state: Phase = 'down';
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);

    (async () => {
      while (run.current === my) {
        const secs = (Date.now() - t0) / 1000;
        const alive = await probe();
        if (run.current !== my) return;
        if (state === 'down') {
          if (!alive) { state = 'up'; setPhase('up'); }
          else if (secs > NO_DROP_S) { state = 'back'; }
        } else if (alive) {
          state = 'back';
        } else if (secs > SLOW_S) {
          setPhase('slow');
        }
        if (state === 'back') {
          setPhase('back');
          // give rpcd/uhttpd a moment before the user logs in again
          await new Promise((r) => setTimeout(r, 4000));
          if (run.current === my) finish('The node is back. Please sign in again.');
          return;
        }
        await new Promise((r) => setTimeout(r, state === 'down' ? 2000 : 3000));
      }
    })();

    return () => clearInterval(tick);
  }, [opts, finish]);

  const pct = phase === 'back' ? 100 : Math.min(95, Math.round((elapsed / EXPECTED_S) * 100));

  return (
    <Ctx.Provider value={start}>
      {children}
      {opts && (
        <div className="reboot-screen" role="dialog" aria-modal="true" aria-labelledby="reboot-title">
          <div className="reboot-card">
            <div className={'reboot-logo' + (phase === 'back' || opts.manual ? '' : ' pulsing')}>
              <Logo size={56} />
            </div>
            <h1 id="reboot-title">{opts.title}</h1>
            {opts.message && <div className="reboot-msg">{opts.message}</div>}

            {opts.manual ? (
              <>
                <a className="btn btn-primary" href={opts.manual.href}>
                  <ExternalLink size={16} /> {opts.manual.label}
                </a>
                <button className="link-btn" onClick={() => finish()}>Back to sign in</button>
              </>
            ) : (
              <>
                <div className="reboot-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
                <p className="reboot-phase" aria-live="polite">
                  {phase === 'down' && <><RotateCw size={15} className="spin" /> Shutting down…</>}
                  {phase === 'up' && <><RotateCw size={15} className="spin" /> Waiting for the node to come back · {elapsed}s</>}
                  {phase === 'back' && <><CheckCircle2 size={15} /> Done, the node is back</>}
                  {phase === 'slow' && <><AlertTriangle size={15} /> Taking longer than usual · {elapsed}s</>}
                </p>
                {phase === 'slow' && (
                  <div className="reboot-actions">
                    <p className="hint">Check that the node's light is on and that this device is still connected to the network.</p>
                    <Button variant="ghost" onClick={() => location.reload()}>Reload page</Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useReboot = () => useContext(Ctx);
