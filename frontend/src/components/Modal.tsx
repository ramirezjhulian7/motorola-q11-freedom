import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './feedback.css';

/**
 * Dialog on top of the native <dialog>: focus trap, Esc and backdrop for free.
 * `onClose` fires on Esc, backdrop click and the X button; pass `locked` to
 * disable all three while something is running.
 */
export function Modal({ open, onClose, title, children, footer, wide, locked }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={'modal' + (wide ? ' modal-wide' : '')}
      onCancel={(e) => { e.preventDefault(); if (!locked) onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}
    >
      {open && (
        <div className="modal-inner">
          <header className="modal-head">
            <h2>{title}</h2>
            <button className="icon-btn ghost" onClick={onClose} disabled={locked} aria-label="Close">
              <X size={18} />
            </button>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
