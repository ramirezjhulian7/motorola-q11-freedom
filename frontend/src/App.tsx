import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { StatusProvider, useStatus } from './status';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/Confirm';
import { RebootProvider } from './components/Rebooting';
import { Layout } from './components/Layout';
import { Splash } from './components/Splash';
import { Login } from './pages/Login';
import { SlaveView } from './pages/SlaveView';
import { Dashboard } from './pages/Dashboard';
import { Mesh } from './pages/Mesh';
import { Devices } from './pages/Devices';
import { Wifi } from './pages/Wifi';
import { Network } from './pages/Network';
import { System } from './pages/System';

/** Waits for the first `status`; a slave only gets the informative screen. */
function NodeGate() {
  const { status, error, refresh } = useStatus();
  const { logout } = useAuth();
  if (!status) {
    return error
      ? <Splash error={error.message} onRetry={refresh} onLogout={() => logout()} />
      : <Splash />;
  }
  return status.role === 'slave' ? <SlaveView /> : <Layout />;
}

function Protected() {
  const { authed } = useAuth();
  if (!authed) return <Navigate to="/login" replace />;
  return <StatusProvider><NodeGate /></StatusProvider>;
}

function LoginRoute() {
  const { authed } = useAuth();
  return authed ? <Navigate to="/" replace /> : <Login />;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <RebootProvider>
          <ConfirmProvider>
            <HashRouter>
              <Routes>
                <Route path="/login" element={<LoginRoute />} />
                <Route element={<Protected />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/mesh" element={<Mesh />} />
                  <Route path="/devices" element={<Devices />} />
                  <Route path="/wifi" element={<Wifi />} />
                  <Route path="/network" element={<Network />} />
                  <Route path="/system" element={<System />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </HashRouter>
          </ConfirmProvider>
        </RebootProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
