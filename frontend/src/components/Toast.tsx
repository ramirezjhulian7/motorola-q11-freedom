import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import './feedback.css';

type Tone = 'ok' | 'err' | 'info';
interface Item { id: number; tone: Tone; text: string; }

interface ToastApi {
  ok: (text: string) => void;
  err: (text: string) => void;
  info: (text: string) => void;
}

const Ctx = createContext<ToastApi>(null!);
const ICON = { ok: CheckCircle2, err: AlertCircle, info: Info };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);

  const push = useCallback((tone: Tone, text: string) => {
    const id = next.current++;
    setItems((l) => [...l.slice(-3), { id, tone, text }]);
    setTimeout(() => dismiss(id), tone === 'err' ? 7000 : 4500);
  }, [dismiss]);

  const api = useMemo<ToastApi>(() => ({
    ok: (t) => push('ok', t),
    err: (t) => push('err', t),
    info: (t) => push('info', t),
  }), [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => {
          const Icon = ICON[t.tone];
          return (
            <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'err' ? 'alert' : 'status'}>
              <Icon size={18} />
              <span>{t.text}</span>
              <button className="icon-btn ghost" onClick={() => dismiss(t.id)} aria-label="Dismiss notice">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

/** Message of an unknown thrown value. */
export const errMsg = (e: unknown, fallback = 'Something went wrong.') =>
  (e instanceof Error && e.message) || fallback;
