import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import './feedback.css';
import { t } from '../i18n';

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

  const dismiss = useCallback((id: number) => setItems((l) => l.filter((x) => x.id !== id)), []);

  const push = useCallback((tone: Tone, text: string) => {
    const id = next.current++;
    setItems((l) => [...l.slice(-3), { id, tone, text }]);
    setTimeout(() => dismiss(id), tone === 'err' ? 7000 : 4500);
  }, [dismiss]);

  const api = useMemo<ToastApi>(() => ({
    ok: (text) => push('ok', text),
    err: (text) => push('err', text),
    info: (text) => push('info', text),
  }), [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((it) => {
          const Icon = ICON[it.tone];
          return (
            <div key={it.id} className={`toast toast-${it.tone}`} role={it.tone === 'err' ? 'alert' : 'status'}>
              <Icon size={18} />
              <span>{it.text}</span>
              <button className="icon-btn ghost" onClick={() => dismiss(it.id)} aria-label={t('Dismiss notice')}>
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
export const errMsg = (e: unknown, fallback = t('Something went wrong.')) =>
  (e instanceof Error && e.message) || fallback;
