import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Copy, Search } from 'lucide-react';
import { Modal } from './Modal';
import { Button, Spinner } from './ui';
import { useToast, errMsg } from './Toast';

/** Modal with the last lines of a node's syslog, with a text filter. */
export function LogViewer({ open, onClose, title, load }: {
  open: boolean; onClose: () => void; title: string; load: () => Promise<string>;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const pre = useRef<HTMLPreElement>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const fetchLog = async () => {
    setBusy(true); setErr('');
    try { setText(await loadRef.current()); }
    catch (e) { setErr(errMsg(e, 'Could not read the log.')); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (open) { setQ(''); setText(''); fetchLog(); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = useMemo(() => {
    const all = text.split('\n').filter(Boolean);
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((l) => l.toLowerCase().includes(needle)) : all;
  }, [text, q]);

  useEffect(() => {
    if (pre.current && !q) pre.current.scrollTop = pre.current.scrollHeight;
  }, [lines, q]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(lines.join('\n')); toast.ok('Log copied.'); }
    catch { toast.err('The browser did not allow copying.'); }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} wide
           footer={<>
             <Button variant="ghost" onClick={copy} disabled={!lines.length}><Copy size={16} /> Copy</Button>
             <Button variant="ghost" onClick={fetchLog} disabled={busy}><RefreshCw size={16} /> Refresh</Button>
           </>}>
      <div className="log-tools">
        <Search size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter (e.g. freedom, wl0, dhcp)"
               aria-label="Filter log" />
        <span className="dim mono">{lines.length} lines</span>
      </div>
      {busy && !text ? <div className="loading"><Spinner /></div>
        : err ? <p className="msg-err">{err}</p>
        : <pre ref={pre} className="log-pre">{lines.length ? lines.join('\n') : 'No matching lines.'}</pre>}
    </Modal>
  );
}
