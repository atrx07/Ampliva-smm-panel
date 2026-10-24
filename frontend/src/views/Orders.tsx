import { useCallback, useEffect, useState } from 'react';
import { cancelOrder, getOrders, refillOrder, refreshOrder } from '../api';
import { formatDate, formatMoney, formatNumber } from '../lib/format';
import type { Order } from '../types';

export function Orders({ currency }: { currency: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const o = await getOrders();
      setOrders(o.orders);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load orders');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function actOnOrder(id: string, action: 'refresh' | 'refill' | 'cancel') {
    setBusyId(id);
    try {
      if (action === 'refresh') await refreshOrder(id);
      if (action === 'refill') await refillOrder(id);
      if (action === 'cancel') await cancelOrder(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="dash">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Account</div>
          <h2>Order history</h2>
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}
      <article className="panel wide">
        {!orders.length && <p className="modal-sub">No orders yet — pick a service from the catalogue to place your first one.</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Service</th><th>Link</th><th>Qty</th><th>Charge</th><th>Status</th><th>Remains</th><th></th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.service_name}</td>
                  <td className="link-cell"><a href={o.link} target="_blank" rel="noreferrer">{o.link}</a></td>
                  <td>{formatNumber(o.quantity)}</td>
                  <td>{formatMoney(o.charge, currency)}{o.refund_amount > 0 && <span className="pos"> (refunded {formatMoney(o.refund_amount, currency)})</span>}</td>
                  <td>{o.status}</td>
                  <td>{o.remains ?? '—'}</td>
                  <td className="row-actions">
                    <button disabled={busyId === o.id} onClick={() => actOnOrder(o.id, 'refresh')}>Refresh</button>
                    <button disabled={busyId === o.id} onClick={() => actOnOrder(o.id, 'refill')}>Refill</button>
                    <button disabled={busyId === o.id} onClick={() => actOnOrder(o.id, 'cancel')}>Cancel</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="modal-sub">Refills you request here are recorded — see them on the Refill history page.</p>
      </article>
    </main>
  );
}
