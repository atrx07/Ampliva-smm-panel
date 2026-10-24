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
import { Icon } from './components/icons';
import { OrderModal } from './components/OrderModal';
import { SideMenu } from './components/SideMenu';
import { useRoute } from './lib/router';
import { Admin } from './views/Admin';
import { Dashboard } from './views/Dashboard';
import { Landing } from './views/Landing';
import { Orders } from './views/Orders';
import { Profile } from './views/Profile';
import { Refills } from './views/Refills';
import { Store } from './views/Store';
import { Wallet } from './views/Wallet';
import type { AuthUser, PublicConfig, Service, ServicesResponse } from './types';

function LoginPrompt({ title, text, onLogin }: { title: string; text: string; onLogin: () => void }) {
  return (
    <main className="dash">
      <article className="panel">
        <h3>{title}</h3>
        <p className="modal-sub">{text}</p>
        <button className="primary-button" type="button" onClick={onLogin}>Log in / Sign up</button>
      </article>
    </main>
  );
}

function App() {
  const [catalog, setCatalog] = useState<ServicesResponse | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [user, setUser] = useState<AuthUser | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [route, navigate] = useRoute();
  const [authOpen, setAuthOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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

  function goHow(event?: React.MouseEvent) {
    event?.preventDefault();
    setMenuOpen(false);
    navigate('/');
    window.setTimeout(() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' }), 60);
  }

  // Menu navigation: close the drawer, then navigate. Each menu entry is
  // a real page now, so no section scrolling is needed.
  function goMenu(path: string) {
    setMenuOpen(false);
    navigate(path);
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
        <button className="menu-button" type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen}>
          <Icon name="menu" size={22} />
        </button>
      </header>

      <SideMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        user={user}
        balance={balance}
        currency={currency}
        route={route}
        go={goMenu}
        goHow={() => goHow()}
        onLogin={() => { setMenuOpen(false); setAuthOpen(true); }}
        onLogout={() => { setMenuOpen(false); handleLogout(); }}
      />

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
        <Dashboard currency={currency} onGo={(path) => navigate(path)} />
      ) : (
        <LoginPrompt title="Log in to see your dashboard" text="Your stats and shortcuts live here." onLogin={() => setAuthOpen(true)} />
      ))}

      {route === '/profile' && (user ? (
        <Profile currency={currency} />
      ) : (
        <LoginPrompt title="Log in to see your profile" text="Your account details live here." onLogin={() => setAuthOpen(true)} />
      ))}

      {route === '/wallet' && (user ? (
        <Wallet currency={currency} config={config} onBalanceChange={setBalance} />
      ) : (
        <LoginPrompt title="Log in to see your wallet" text="Your balance and top-ups live here." onLogin={() => setAuthOpen(true)} />
      ))}

      {route === '/orders' && (user ? (
        <Orders currency={currency} />
      ) : (
        <LoginPrompt title="Log in to see your orders" text="Your order history lives here." onLogin={() => setAuthOpen(true)} />
      ))}

      {route === '/refills' && (user ? (
        <Refills />
      ) : (
        <LoginPrompt title="Log in to see your refills" text="Your refill history lives here." onLogin={() => setAuthOpen(true)} />
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

      {route !== '/' && route !== '/store' && route !== '/dashboard' && route !== '/profile' && route !== '/wallet' && route !== '/orders' && route !== '/refills' && route !== '/admin' && (
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
            navigate('/orders');
          }}
        />
      )}
    </div>
  );
}

export default App;
