import { useEffect, useRef } from 'react';
import { formatMoney } from '../lib/format';
import type { AuthUser } from '../types';
import { Icon, type IconName } from './icons';

// Slide-in drawer that holds every navigation entry, so the header stays
// a brand mark plus one menu button. Account entries navigate to the
// dashboard and scroll to the matching section (the dashboard is one
// page: profile, wallet and orders are panels on it).
export function SideMenu({ open, onClose, user, balance, currency, route, section, go, goHow, onLogin, onLogout }: {
  open: boolean;
  onClose: () => void;
  user: AuthUser | null;
  balance: number | null;
  currency: string;
  route: string;
  section: string | null;
  go: (path: string, section?: string | null) => void;
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

          {user && (
            <>
              <div className="drawer-group-label">Account</div>
              {item('dashboard', 'Dashboard', 'dashboard', () => go('/dashboard'), route === '/dashboard' && !section)}
              {item('profile', 'Profile', 'user', () => go('/dashboard', 'profile'), route === '/dashboard' && section === 'profile')}
              {item('wallet', 'Wallet', 'wallet', () => go('/dashboard', 'wallet'), route === '/dashboard' && section === 'wallet')}
              {item('orders', 'Order history', 'history', () => go('/dashboard', 'orders'), route === '/dashboard' && section === 'orders')}
              {item('refills', 'Refill history', 'refill', () => go('/dashboard', 'orders'), route === '/dashboard' && section === 'orders')}
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
