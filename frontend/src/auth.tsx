import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { login as ubusLogin, logout as ubusLogout, isAuthenticated, touchSession, onSessionLost } from './lib/ubus';
import { useToast } from './components/Toast';
import { t } from './i18n';

interface AuthCtx {
  authed: boolean;
  login: (user: string, pass: string) => Promise<void>;
  /** Back to the login; `msg` is shown as a notice. */
  logout: (msg?: string) => void;
  /** While true, a lost session doesn't raise the "expired" notice (reboots). */
  setQuiet: (q: boolean) => void;
}

const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [authed, setAuthed] = useState(isAuthenticated());
  const quiet = useRef(false);

  // Any 401 from the CGI or ubus status 6 lands here.
  useEffect(() => {
    onSessionLost(() => {
      setAuthed(false);
      if (!quiet.current) toast.info(t('Your session expired. Please sign in again.'));
    });
    return () => onSessionLost(null);
  }, [toast]);

  // Keep the ubus session alive (token expires in 300s) and detect drops.
  useEffect(() => {
    if (!authed) return;
    const timer = setInterval(async () => {
      const ok = await touchSession();
      if (!ok) setAuthed(false);
    }, 120_000);
    return () => clearInterval(timer);
  }, [authed]);

  const login = useCallback(async (user: string, pass: string) => {
    await ubusLogin(user, pass);
    setAuthed(true);
  }, []);

  const logout = useCallback((msg?: string) => {
    ubusLogout();
    setAuthed(false);
    if (msg) toast.info(msg);
  }, [toast]);

  const setQuiet = useCallback((q: boolean) => { quiet.current = q; }, []);

  return <Ctx.Provider value={{ authed, login, logout, setQuiet }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
