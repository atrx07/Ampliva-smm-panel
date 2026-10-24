import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelOrder, getOrders, getRefills, refillOrder, refreshOrder } from '../api';
import { formatMoney, formatNumber } from '../lib/format';
import type { Order, RefillRequest } from '../types';

// Cooldown after a successful refill: the Refill button turns red and
// crossed-out until this long after the last submitted refill, and the
// bubble shows the remaining time. Proposal (see report): 24 hours —
// the one number to change if the owner wants a different window.
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function Orders({ currency }: { currency: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [refills, setRefills] = useState<RefillRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Ticks once a minute so cooldown buttons flip green when their window
  // ends without needing a reload.
  const [now, setNow] = useState(() => Date.now());
  const [bubble, setBubble] = useState<{ orderId: string; top: number; left: number; endsAt: number } | null>(null);
  const bubbleTimer = useRef<number | null>(null);
  // Set when a tap on the already-open bubble's own button dismisses it,
  // so the click that follows that tap doesn't immediately reopen it.
  const suppressedClick = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const closeBubble = useCallback(() => {
    if (bubbleTimer.current !== null) {
      window.clearTimeout(bubbleTimer.current);
      bubbleTimer.current = null;
    }
    setBubble(null);
  }, []);

  // While the bubble is open, any other touch input dismisses it: taps,
  // swipes, drags, scrolls. Capture phase, so this runs before the tap's
  // own click handler.
  useEffect(() => {
    if (!bubble) return;
    const dismiss = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest?.('.refill-btn.cooldown');
      // A tap on the same button that opened the bubble dismisses it and
      // suppresses the click that follows, so it doesn't instantly reopen.
      if (button?.getAttribute('data-order-id') === bubble.orderId) {
        suppressedClick.current = true;
      }
      closeBubble();
    };
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('touchstart', dismiss, true);
    window.addEventListener('touchmove', dismiss, true);
    window.addEventListener('wheel', dismiss, true);
    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('touchstart', dismiss, true);
      window.removeEventListener('touchmove', dismiss, true);
      window.removeEventListener('wheel', dismiss, true);
    };
  }, [bubble, closeBubble]);

  useEffect(() => () => {
    if (bubbleTimer.current !== null) window.clearTimeout(bubbleTimer.current);
  }, []);

  const load = useCallback(async () => {
    try {
      const [o, r] = await Promise.all([getOrders(), getRefills()]);
      setOrders(o.orders);
      setRefills(r.refills);
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

  // Cooldown end for an order, from its latest successful refill, or null
  // when a refill is available (never refilled, or window already passed).
  function cooldownEndsAt(orderId: string): number | null {
    const last = refills
      .filter((r) => r.order_id === orderId && r.status === 'submitted')
      .map((r) => new Date(r.created_at).getTime())
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => b - a)[0];
    if (last === undefined) return null;
    const endsAt = last + COOLDOWN_MS;
    return now < endsAt ? endsAt : null;
  }

  // Hours and minutes only, never seconds.
  function formatRemaining(endsAt: number): string {
    const totalMinutes = Math.max(0, Math.floor((endsAt - now) / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  function openBubble(orderId: string, endsAt: number, buttonEl: HTMLButtonElement) {
    const rect = buttonEl.getBoundingClientRect();
    const width = 220;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    // Below the button, or above it when there is no room below.
    const top = rect.bottom + 8 + 64 <= window.innerHeight ? rect.bottom + 8 : rect.top - 64;
    if (bubbleTimer.current !== null) window.clearTimeout(bubbleTimer.current);
    setBubble({ orderId, top, left, endsAt });
    bubbleTimer.current = window.setTimeout(() => setBubble(null), 10000);
  }

  function handleCooldownClick(orderId: string, endsAt: number, buttonEl: HTMLButtonElement) {
    if (suppressedClick.current) {
      suppressedClick.current = false;
      return;
    }
    openBubble(orderId, endsAt, buttonEl);
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
              {orders.map((o) => {
                const endsAt = o.service_refill === 1 ? cooldownEndsAt(o.id) : null;
                return (
                  <tr key={o.id}>
                    <td>{o.service_name}</td>
                    <td className="link-cell"><a href={o.link} target="_blank" rel="noreferrer">{o.link}</a></td>
                    <td>{formatNumber(o.quantity)}</td>
                    <td>{formatMoney(o.charge, currency)}{o.refund_amount > 0 && <span className="pos"> (refunded {formatMoney(o.refund_amount, currency)})</span>}</td>
                    <td>{o.status}</td>
                    <td>{o.remains ?? '—'}</td>
                    <td className="row-actions">
                      <button disabled={busyId === o.id} onClick={() => actOnOrder(o.id, 'refresh')}>Refresh</button>
                      {o.service_refill === 1 && (endsAt !== null ? (
                        <button
                          type="button"
                          className="refill-btn cooldown"
                          data-order-id={o.id}
                          disabled={busyId === o.id}
                          onClick={(e) => handleCooldownClick(o.id, endsAt, e.currentTarget)}
                        >
                          <span className="refill-label">Refill</span>
                          <span className="refill-foot">on cooldown</span>
                        </button>
                      ) : (
                        <button type="button" className="refill-btn" disabled={busyId === o.id} onClick={() => actOnOrder(o.id, 'refill')}>Refill</button>
                      ))}
                      <button disabled={busyId === o.id} onClick={() => actOnOrder(o.id, 'cancel')}>Cancel</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="modal-sub">Refills you request here are recorded — see them on the Refill history page.</p>
      </article>

      {bubble && (
        <div className="cooldown-bubble" style={{ top: bubble.top, left: bubble.left }}>
          Refill available in {formatRemaining(bubble.endsAt)}
        </div>
      )}
    </main>
  );
}
