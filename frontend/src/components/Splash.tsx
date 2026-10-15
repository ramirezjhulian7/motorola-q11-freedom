import { Logo } from './Logo';
import { Button, Spinner } from './ui';
import './feedback.css';
import { t } from '../i18n';

/** Full-screen state while the first `status` loads (or fails). */
export function Splash({ error, onRetry, onLogout }: {
  error?: string; onRetry?: () => void; onLogout?: () => void;
}) {
  return (
    <div className="splash">
      <Logo size={48} />
      {error ? (
        <>
          <p className="splash-err" role="alert">{t('Could not read the node status: {error}', { error })}</p>
          <div className="splash-actions">
            <Button onClick={onRetry}>{t('Retry')}</Button>
            <Button variant="ghost" onClick={onLogout}>{t('Sign out')}</Button>
          </div>
        </>
      ) : <Spinner />}
    </div>
  );
}
