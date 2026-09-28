import { useEffect, useState } from 'react';
import { Search, Router, CheckCircle2, Info, KeyRound, ArrowLeft } from 'lucide-react';
import { Modal } from './Modal';
import { Button, Field, Spinner } from './ui';
import { errMsg } from './Toast';
import { discoverNodes, adoptNode, BAD_CHARS, type FoundNode, type SyncResult } from '../lib/meshApi';
import { isIp, net3 } from '../lib/format';

type Step = 'find' | 'creds' | 'working' | 'done';

const SYNC_DONE: Record<SyncResult, string> = {
  ok: 'It already has the master\'s WiFi network and password.',
  reboot: 'It is rebooting to apply the master\'s WiFi network (~1 min).',
  offline: 'It did not respond to the first sync. Use "Sync" once it is online.',
  error: 'The first sync failed. Use "Sync" in the node list.',
};

/**
 * Add-a-slave flow: find it (discover or manual IP) -> its root password and a
 * name -> adopt_node (login + join + first sync, ~10-20 s) -> result.
 */
export function AddNodeWizard({ open, onClose, masterIp, knownIps }: {
  open: boolean;
  onClose: (added?: boolean) => void;
  masterIp: string;
  knownIps: string[];
}) {
  const [step, setStep] = useState<Step>('find');
  const [found, setFound] = useState<FoundNode[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState('');
  const [ip, setIp] = useState('');
  const [manual, setManual] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ id: string; sync: SyncResult } | null>(null);

  const lan = net3(masterIp);

  const scan = async () => {
    setScanning(true); setScanErr('');
    try { setFound(await discoverNodes()); }
    catch (e) { setScanErr(errMsg(e, 'Could not search.')); setFound([]); }
    finally { setScanning(false); }
  };

  useEffect(() => {
    if (!open) return;
    setStep('find'); setFound(null); setIp(''); setManual(''); setPassword('');
    setName(''); setErr(''); setResult(null); setShowPw(false);
    scan();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const manualErr = (() => {
    const v = manual.trim();
    if (!v) return '';
    if (!isIp(v)) return 'Enter a full IP, e.g. ' + lan + '.2';
    if (net3(v) !== lan) return `It must be on the master's network (${lan}.x).`;
    if (v === masterIp) return 'That is the master\'s IP.';
    if (knownIps.includes(v)) return 'That node is already in the mesh.';
    return '';
  })();

  const pick = (v: string) => { setIp(v); setErr(''); setStep('creds'); };

  const nameErr = BAD_CHARS.test(name) ? 'The name cannot contain quotes, \\, $ or `.' : '';

  const adopt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || nameErr) return;
    setStep('working'); setErr('');
    try {
      const r = await adoptNode(ip, password, name.trim());
      setResult({ id: r.id, sync: r.sync });
      setStep('done');
    } catch (ex) {
      setErr(errMsg(ex, 'Could not add the node.'));
      setStep('creds');
    }
  };

  const title = step === 'done' ? 'Node added' : 'Add a node';
  const stepNo = { find: 1, creds: 2, working: 2, done: 3 }[step];

  return (
    <Modal open={open} onClose={() => onClose(step === 'done')} title={title} locked={step === 'working'}
           footer={
             step === 'find' ? (
               <>
                 <Button variant="ghost" onClick={() => onClose()}>Cancel</Button>
                 <Button onClick={() => pick(manual.trim())} disabled={!manual.trim() || !!manualErr}>Next</Button>
               </>
             ) : step === 'creds' ? (
               <>
                 <Button variant="ghost" onClick={() => setStep('find')}><ArrowLeft size={16} /> Back</Button>
                 <Button type="submit" form="adopt-form" disabled={!password || !!nameErr}>Add to mesh</Button>
               </>
             ) : step === 'done' ? (
               <Button onClick={() => onClose(true)}>Done</Button>
             ) : null
           }>
      <ol className="wiz-steps" aria-label={`Step ${stepNo} of 3`}>
        {['Find', 'Access', 'Done'].map((s, i) => (
          <li key={s} className={i + 1 < stepNo ? 'done' : i + 1 === stepNo ? 'on' : ''}>{s}</li>
        ))}
      </ol>

      {step === 'find' && (
        <div className="form">
          <p className="info-box"><Info size={15} />
            <span>The node must be provisioned as a slave (<code>provision.sh &lt;ip&gt; &lt;password&gt; --role slave --lan-ip {lan}.N</code>) and wired to a LAN port of the master.</span>
          </p>

          <div className="wiz-scan-head">
            <strong>Nodes found</strong>
            <button className="link-btn" onClick={scan} disabled={scanning}>
              <Search size={14} /> {scanning ? 'Searching…' : 'Search again'}
            </button>
          </div>
          {scanning ? (
            <div className="wiz-scanning"><Spinner /> Looking for Q11 Freedom nodes on {lan}.x…</div>
          ) : scanErr ? (
            <p className="msg-err">{scanErr}</p>
          ) : found && found.length > 0 ? (
            <div className="wiz-found">
              {found.map((f) => (
                <button key={f.ip} className="wiz-cand" onClick={() => pick(f.ip)}>
                  <Router size={18} />
                  <span className="mono">{f.ip}</span>
                  <span className="mono dim">{f.mac}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="hint">No new node showed up. Check the cable or enter its IP below.</p>
          )}

          <Field label="Or enter the node's IP" htmlFor="node-ip" error={manualErr}>
            <input id="node-ip" className="mono" inputMode="decimal" placeholder={`${lan}.2`}
                   value={manual} onChange={(e) => setManual(e.target.value)} aria-invalid={!!manualErr}
                   onKeyDown={(e) => { if (e.key === 'Enter' && manual.trim() && !manualErr) pick(manual.trim()); }} />
          </Field>
        </div>
      )}

      {step === 'creds' && (
        <form id="adopt-form" className="form" onSubmit={adopt}>
          <p className="wiz-target"><Router size={16} /> Node at <b className="mono">{ip}</b></p>
          <Field label={<><KeyRound size={13} /> Node root password</>} htmlFor="node-pw"
                 hint="The one you used when provisioning it. It is used only once: afterwards the master copies its own over.">
            <div className="pass-row">
              <input id="node-pw" type={showPw ? 'text' : 'password'} value={password} autoFocus
                     onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
              <button type="button" className="pass-toggle" onClick={() => setShowPw((s) => !s)}>
                {showPw ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>
          <Field label="Name (optional)" htmlFor="node-name" error={nameErr}
                 hint="Where it is, so you can tell it apart: Bedroom, Office, Patio…">
            <input id="node-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)}
                   placeholder="e.g. Bedroom" aria-invalid={!!nameErr} />
          </Field>
          {err && <p className="msg-err" role="alert">{err}</p>}
        </form>
      )}

      {step === 'working' && (
        <div className="wiz-working">
          <Spinner />
          <strong>Adding {ip}…</strong>
          <p className="hint">Signing in to the node, handing it the mesh key and copying the WiFi network. It takes about 20 seconds.</p>
        </div>
      )}

      {step === 'done' && result && (
        <div className="wiz-working">
          <CheckCircle2 size={40} className="wiz-ok" />
          <strong>{name.trim() || result.id} is now part of the mesh</strong>
          <p className="hint">ID <span className="mono">{result.id}</span> · {SYNC_DONE[result.sync] ?? result.sync}</p>
        </div>
      )}
    </Modal>
  );
}
