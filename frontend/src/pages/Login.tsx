import { useState } from 'react';
import { useAuth } from '../auth';
import { Button } from '../components/ui';
import { Logo } from '../components/Logo';
import './Login.css';

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
      setErr('Wrong username or password.');
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
          <p>Local control panel</p>
        </div>

        <label htmlFor="user">Username</label>
        <input id="user" autoComplete="username" value={user}
               onChange={(e) => setUser(e.target.value)} />

        <label htmlFor="pass">Password</label>
        <div className="pass-row">
          <input id="pass" type={show ? 'text' : 'password'} autoComplete="current-password"
                 value={pass} onChange={(e) => setPass(e.target.value)} autoFocus />
          <button type="button" className="pass-toggle" onClick={() => setShow((s) => !s)}
                  aria-label={show ? 'Hide password' : 'Show password'}>
            {show ? 'Hide' : 'Show'}
          </button>
        </div>

        {err && <p className="login-err" role="alert">{err}</p>}

        <Button type="submit" disabled={busy || !pass}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
