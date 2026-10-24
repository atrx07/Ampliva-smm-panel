import { useCallback, useEffect, useState } from 'react';
import {
  getConfig,
  getMe,
  getServices,
  getToken,
  logout as apiLogout,
  setToken,
} from './api';
import { AuthModal } from './components/AuthModal';
import { OrderModal } from './components/OrderModal';
import { formatMoney } from './lib/format';
import { useRoute } from './lib/router';
import { Admin } from './views/Admin';
import { Dashboard } from './views/Dashboard';
import { Landing } from './views/Landing';
import { Store } from './views/Store';
import type { AuthUser, PublicConfig, Service, ServicesResponse } from './types';

function App() {
  const [catalog, setCatalog] = useState<ServicesResponse | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [user, setUser] = useState<AuthUser | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [route, navigate] = useRoute();
  const [authOpen, setAuthOpen] = useState(false);
  const [orderService, setOrderService] = useState<Service | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const currency = catalog?.currency ?? config?.currency ?? 'INR';

  const refreshMe = useCallback(async () => {
    if (!getToken()) return;
    try {
      const me = await getMe();
      setUser(me.user);
      setBalance(me.balance);
    } catch {
      setToken(null);
      setUser(null);
      setBalance(null);
    }
  }, []);

  useEffect(() => {
    getServices().then(setCatalog).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load services')).finally(() => setLoading(false));
    getConfig().then(setConfig).catch(() => undefined);
    refreshMe();
  }, [refreshMe]);

  async function handleLogout() {
    try { await apiLogout(); } catch { /* token cleared regardless */ }
    setToken(null);
    setUser(null);
    setBalance(null);
    navigate('/');
  }

  function handleOrderClick(service: Service) {
    if (!user) {
      setAuthOpen(true);
      setNotice('Log in or create an account to place an order.');
      return;
    }
    if (!config?.orderingEnabled) {
      setNotice('Ordering opens as soon as the live provider connection is switched on. Browsing works fully until then.');
      return;
    }
    setOrderService(service);
  }

  function goHow(event: React.MouseEvent) {
    event.preventDefault();
    navigate('/');
    window.setTimeout(() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' }), 60);
  }

  function go(path: string) {
    return (event: React.MouseEvent) => {
      event.preventDefault();
      navigate(path);
    };
  }

  return (
    <div className="app-shell">
      <header className="nav-wrap">
        <a className="brand" href="/" aria-label="Ampliva home" onClick={go('/')}>
          <span className="brand-mark">A</span>
          <span>Ampliva</span>
        </a>
        <nav>
          <a href="/store" onClick={go('/store')}>Store</a>
          <a href="/#how" onClick={goHow}>How it works</a>
          {user ? (
            <>
              <span className="balance-chip">{formatMoney(balance ?? 0, currency)}</span>
              <button className="ghost-button" type="button" onClick={() => navigate('/dashboard')}>Dashboard</button>
              {user.role === 'admin' && (
                <button className="ghost-button" type="button" onClick={() => navigate('/admin')}>Admin</button>
              )}
              <button className="ghost-button" type="button" onClick={handleLogout}>Log out</button>
            </>
          ) : (
            <button className="ghost-button" type="button" onClick={() => setAuthOpen(true)}>Log in / Sign up</button>
          )}
        </nav>
      </header>

      {notice && <div className="notice top-notice">{notice} <button className="link-button" onClick={() => setNotice(null)}>Dismiss</button></div>}

      {route === '/' && (
        <Landing
          serviceCount={catalog?.services.length ?? 0}
          orderingEnabled={config?.orderingEnabled ?? false}
          onExplore={() => navigate('/store')}
        />
      )}

      {route === '/store' && (
        <Store
          catalog={catalog}
          loading={loading}
          error={error}
          user={Boolean(user)}
          currency={currency}
          onOrderClick={handleOrderClick}
        />
      )}

      {route === '/dashboard' && (user ? (
        <Dashboard
          currency={currency}
          config={config}
          onBalanceChange={setBalance}
          onBrowse={() => navigate('/store')}
        />
      ) : (
        <main className="dash">
          <article className="panel">
            <h3>Log in to see your dashboard</h3>
            <p className="modal-sub">Your wallet, top-ups and orders live here.</p>
            <button className="primary-button" type="button" onClick={() => setAuthOpen(true)}>Log in / Sign up</button>
          </article>
        </main>
      ))}

      {route === '/admin' && (user?.role === 'admin' ? (
        <Admin currency={currency} />
      ) : (
        <main className="dash">
          <article className="panel">
            <h3>Admin area</h3>
            <p className="modal-sub">This area is for the store admin.</p>
            <button className="primary-button" type="button" onClick={() => navigate('/')}>Back to home</button>
          </article>
        </main>
      ))}

      {route !== '/' && route !== '/store' && route !== '/dashboard' && route !== '/admin' && (
        <Landing
          serviceCount={catalog?.services.length ?? 0}
          orderingEnabled={config?.orderingEnabled ?? false}
          onExplore={() => navigate('/store')}
        />
      )}

      <footer>
        <div className="brand"><span className="brand-mark">A</span><span>Ampliva</span></div>
        <p>Promotional services should be represented accurately and never presented as guaranteed organic growth.</p>
      </footer>

      {authOpen && (
        <AuthModal
          onClose={() => setAuthOpen(false)}
          onAuthed={(authedUser) => {
            setUser(authedUser);
            setAuthOpen(false);
            refreshMe();
          }}
        />
      )}

      {orderService && (
        <OrderModal
          service={orderService}
          currency={currency}
          balance={balance ?? 0}
          onClose={() => setOrderService(null)}
          onOrdered={(newBalance) => {
            setBalance(newBalance);
            setOrderService(null);
            navigate('/dashboard');
          }}
        />
      )}
    </div>
  );
}

export default App;
