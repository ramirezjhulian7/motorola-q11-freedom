import { useState } from 'react';
import { useAuth } from '../auth';
import { Button } from '../components/ui';
import { Logo } from '../components/Logo';
import { t } from '../i18n';
import './Login.css';

// The demo router (npm run demo or the GitHub Pages build) accepts any password.
const DEMO = import.meta.env.MODE === 'demo' || import.meta.env.VITE_STATIC_DEMO === '1';

export function Login() {
  const { login } = useAuth();
  const [user, setUser] = useState('root');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await login(user, pass);
    } catch {
      setErr(t('Wrong username or password.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <Logo size={48} />
          <h1>Q11 <span>Freedom</span></h1>
          <p>{t('Local control panel')}</p>
        </div>

        <label htmlFor="user">{t('Username')}</label>
        <input id="user" autoComplete="username" value={user}
               onChange={(e) => setUser(e.target.value)} />

        <label htmlFor="pass">{t('Password')}</label>
        <div className="pass-row">
          <input id="pass" type={show ? 'text' : 'password'} autoComplete="current-password"
                 value={pass} onChange={(e) => setPass(e.target.value)} autoFocus />
          <button type="button" className="pass-toggle" onClick={() => setShow((s) => !s)}
                  aria-label={show ? t('Hide password') : t('Show password')}>
            {show ? t('Hide') : t('Show')}
          </button>
        </div>

        {DEMO && <p className="login-hint">{t('Demo mode: any password works.')}</p>}

        {err && <p className="login-err" role="alert">{err}</p>}

        <Button type="submit" disabled={busy || !pass}>
          {busy ? t('Signing in…') : t('Sign in')}
        </Button>
      </form>
    </div>
  );
}
