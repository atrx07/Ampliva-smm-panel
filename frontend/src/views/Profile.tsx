import { useEffect, useState } from 'react';
import { getMe } from '../api';
import { formatMoney } from '../lib/format';
import type { AuthUser } from '../types';

export function Profile({ currency }: { currency: string }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMe()
      .then((me) => {
        setUser(me.user);
        setBalance(me.balance);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load profile'));
  }, []);

  return (
    <main className="dash">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Account</div>
          <h2>Profile</h2>
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}
      <article className="panel">
        <div className="profile-rows">
          <div><span className="muted">Email</span><strong>{user?.email ?? '…'}</strong></div>
          <div><span className="muted">Account type</span><strong>{user ? (user.role === 'admin' ? 'Admin' : 'Member') : '…'}</strong></div>
          <div><span className="muted">Current balance</span><strong>{balance !== null ? formatMoney(balance, currency) : '…'}</strong></div>
        </div>
      </article>
    </main>
  );
}
