import { useCallback, useEffect, useState } from 'react';
import { getOrders, getWallet } from '../api';
import { formatMoney, formatNumber } from '../lib/format';
import type { Order, WalletResponse } from '../types';

// Dashboard, redefined (2026-10-25): a stats hub, not an everything page.
// It shows the four numbers that matter and points at the pages that own
// the details — Profile, Wallet, Order history, Refill history, Store.
export function Dashboard({ currency, onGo }: {
  currency: string;
  onGo: (path: string) => void;
}) {
  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [w, o] = await Promise.all([getWallet(), getOrders()]);
      setWallet(w);
      setOrders(o.orders);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load dashboard');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const balance = wallet?.balance ?? 0;
  const toppedUp = (wallet?.topups ?? [])
    .filter((t) => t.status === 'approved')
    .reduce((sum, t) => sum + t.amount, 0);
  // Net of refunds: money actually spent, not gross charges.
  const spent = orders.reduce((sum, o) => sum + o.charge - (o.refund_amount ?? 0), 0);
  const refunded = orders.reduce((sum, o) => sum + (o.refund_amount ?? 0), 0);

  const card = (title: string, text: string, label: string, path: string) => (
    <article className="panel hub-card" key={path}>
      <h3>{title}</h3>
      <p className="modal-sub">{text}</p>
      <button className="ghost-button" type="button" onClick={() => onGo(path)}>{label}</button>
    </article>
  );

  return (
    <main className="dash">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Your dashboard</div>
          <h2>At a glance</h2>
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}

      <div className="stat-grid">
        <article><strong>{formatMoney(balance, currency)}</strong><span>Current balance</span></article>
        <article><strong>{formatMoney(toppedUp, currency)}</strong><span>Total topped up</span></article>
        <article><strong>{formatMoney(spent, currency)}</strong><span>Total spent</span></article>
        <article><strong>{formatNumber(orders.length)}</strong><span>Orders placed</span></article>
      </div>
      {refunded > 0 && <p className="modal-sub">Includes {formatMoney(refunded, currency)} refunded across your orders.</p>}

      <div className="dash-grid">
        {card('Profile', 'Your account email and account type.', 'Open profile', '/profile')}
        {card('Wallet', 'Balance, top-ups and recent wallet activity.', 'Open wallet', '/wallet')}
        {card('Order history', 'Every order, its status and remaining count.', 'Open orders', '/orders')}
        {card('Refill history', 'Every refill requested, newest first.', 'Open refills', '/refills')}
        {card('Store', 'Browse the catalogue and place a new order.', 'Browse services', '/store')}
      </div>
    </main>
  );
}
