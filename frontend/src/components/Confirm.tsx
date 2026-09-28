import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from './ui';

interface ConfirmOpts {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (o: ConfirmOpts) => Promise<boolean>;
const Ctx = createContext<ConfirmFn>(null!);

/** Promise-based replacement for window.confirm(). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => new Promise((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setOpts(o);
  }), []);

  const close = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal
        open={!!opts}
        onClose={() => close(false)}
        title={opts?.title ?? ''}
        footer={opts && (
          <>
            <Button variant="ghost" onClick={() => close(false)}>{opts.cancelLabel ?? 'Cancel'}</Button>
            <Button variant={opts.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
              {opts.confirmLabel ?? 'Continue'}
            </Button>
          </>
        )}
      >
        <div className="confirm-msg">{opts?.message}</div>
      </Modal>
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
