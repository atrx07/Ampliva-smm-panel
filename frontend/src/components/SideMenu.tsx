import { useEffect, useRef } from 'react';
import { formatMoney } from '../lib/format';
import type { AuthUser } from '../types';
import { Icon, type IconName } from './icons';

// Slide-in drawer that holds every navigation entry, so the header stays
// a brand mark plus one menu button. Every entry is a real page: the
// dashboard is a stats hub, and Profile, Wallet, Order history and
// Refill history are individual pages.
export function SideMenu({ open, onClose, user, balance, currency, route, go, goHow, onLogin, onLogout }: {
  open: boolean;
  onClose: () => void;
  user: AuthUser | null;
  balance: number | null;
  currency: string;
  route: string;
  go: (path: string) => void;
  goHow: () => void;
  onLogin: () => void;
  onLogout: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const item = (key: string, label: string, icon: IconName, onClick: () => void, active = false) => (
    <button key={key} type="button" className={`drawer-item${active ? ' active' : ''}`} onClick={onClick}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Menu">
        <div className="drawer-head">
          <div className="brand">
            <span className="brand-mark">A</span>
            <span>Ampliva</span>
          </div>
          <button ref={closeRef} type="button" className="drawer-close" onClick={onClose} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>

        {user && (
          <div className="drawer-user">
            <span className="drawer-email">{user.email}</span>
            {balance !== null && <span className="balance-chip">{formatMoney(balance, currency)}</span>}
          </div>
        )}

        <nav className="drawer-nav">
          <div className="drawer-group-label">Browse</div>
          {item('store', 'Store', 'store', () => go('/store'), route === '/store')}
          {item('home', 'Home', 'home', () => go('/'), route === '/')}
          {item('how', 'How it works', 'info', goHow)}

          <div className="drawer-group-label">Tools</div>
          {item('lookup', 'Profile Lookup', 'search', () => go('/tools/lookup'), route === '/tools/lookup')}

          {user && (
            <>
              <div className="drawer-group-label">Account</div>
              {item('dashboard', 'Dashboard', 'dashboard', () => go('/dashboard'), route === '/dashboard')}
              {item('profile', 'Profile', 'user', () => go('/profile'), route === '/profile')}
              {item('wallet', 'Wallet', 'wallet', () => go('/wallet'), route === '/wallet')}
              {item('orders', 'Order history', 'history', () => go('/orders'), route === '/orders')}
              {item('refills', 'Refill history', 'refill', () => go('/refills'), route === '/refills')}
            </>
          )}

          {user?.role === 'admin' && (
            <>
              <div className="drawer-group-label">Admin</div>
              {item('admin', 'Admin', 'shield', () => go('/admin'), route === '/admin')}
            </>
          )}
        </nav>

        <div className="drawer-foot">
          {user
            ? item('logout', 'Log out', 'logout', onLogout)
            : item('login', 'Log in / Sign up', 'login', onLogin)}
        </div>
      </aside>
    </>
  );
}
