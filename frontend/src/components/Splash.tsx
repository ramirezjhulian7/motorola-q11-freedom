import { Logo } from './Logo';
import { Button, Spinner } from './ui';
import './feedback.css';

/** Full-screen state while the first `status` loads (or fails). */
export function Splash({ error, onRetry, onLogout }: {
  error?: string; onRetry?: () => void; onLogout?: () => void;
}) {
  return (
    <div className="splash">
      <Logo size={48} />
      {error ? (
        <>
          <p className="splash-err" role="alert">Could not read the node status: {error}</p>
          <div className="splash-actions">
            <Button onClick={onRetry}>Retry</Button>
            <Button variant="ghost" onClick={onLogout}>Sign out</Button>
          </div>
        </>
      ) : <Spinner />}
    </div>
  );
}
