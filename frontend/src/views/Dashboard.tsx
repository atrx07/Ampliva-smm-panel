import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  cancelOrder,
  createRazorpayOrder,
  createTopup,
  getOrders,
  getWallet,
  refillOrder,
  refreshOrder,
} from '../api';
import { formatDate, formatMoney, formatNumber } from '../lib/format';
import type { Order, PublicConfig, WalletResponse } from '../types';

// PARKED 2026-10-24: Razorpay instant payments run on test keys only until live KYC
// clears (physical PAN reprint -> Video KYC -> live keys). While parked, the wallet
// shows a Coming soon banner instead of the instant-pay box, so no customer can
// walk into a test-mode checkout. To resume: set this to false (live keys must be
// in the Worker secrets first).
const RAZORPAY_PARKED = true;

export function Dashboard({ currency, config, onBalanceChange, onBrowse }: {
  currency: string;
  config: PublicConfig | null;
  onBalanceChange: (balance: number) => void;
  onBrowse: () => void;
}) {
  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Raw text state, parsed via `amount` — same leading-zero trap as quantity.
  const [amountText, setAmountText] = useState('100');
  const amount = Math.max(0, Math.floor(Number(amountText) || 0));
  const [txnRef, setTxnRef] = useState('');
  const [topupMsg, setTopupMsg] = useState<string | null>(null);
  const [razorpayBusy, setRazorpayBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const upiLink = config?.upiId
    ? `upi://pay?pa=${encodeURIComponent(config.upiId)}&pn=Ampliva&cu=INR${amount >= 10 ? `&am=${amount}` : ''}`
    : '';

  async function copyUpiId() {
    if (!config?.upiId) return;
    try {
      await navigator.clipboard.writeText(config.upiId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const load = useCallback(async () => {
    try {
      const [w, o] = await Promise.all([getWallet(), getOrders()]);
      setWallet(w);
      setOrders(o.orders);
      onBalanceChange(w.balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load dashboard');
    }
  }, [onBalanceChange]);

  useEffect(() => { load(); }, [load]);

  async function submitTopup(event: React.FormEvent) {
    event.preventDefault();
    setTopupMsg(null);
    try {
      await createTopup(amount, txnRef);
      setTopupMsg('Top-up request sent. Your balance updates once the payment is verified (usually within a few hours).');
      setTxnRef('');
      load();
    } catch (err) {
      setTopupMsg(err instanceof Error ? err.message : 'Top-up failed');
    }
  }

  // Razorpay Checkout is loaded on demand (never bundled, never on page load).
  async function payInstant() {
    if (amount < 10) {
      setTopupMsg('Top-up amount must be at least ₹10.');
      return;
    }
    setTopupMsg(null);
    setRazorpayBusy(true);
    try {
      const order = await createRazorpayOrder(amount);
      if (!(window as unknown as { Razorpay?: unknown }).Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Could not load the payment form. Check your connection and try again.'));
          document.body.appendChild(script);
        });
      }
      const RazorpayCtor = (window as unknown as { Razorpay: new (options: Record<string, unknown>) => {
        open: () => void;
        on: (event: string, handler: (response: { error?: { description?: string } }) => void) => void;
      } }).Razorpay;
      const rzp = new RazorpayCtor({
        key: order.keyId,
        order_id: order.orderId,
        amount: Math.round(order.amount * 100),
        currency: 'INR',
        name: 'Ampliva',
        description: `Wallet top-up ${formatMoney(order.amount, currency)}`,
        // The webhook credits the wallet; the handler only reports + refreshes.
        handler: () => {
          setTopupMsg('Payment received — your balance updates in a few seconds.');
          window.setTimeout(load, 2000);
          window.setTimeout(load, 7000);
        },
        modal: { ondismiss: () => setRazorpayBusy(false) },
      });
      rzp.on('payment.failed', (response) => {
        setTopupMsg(response.error?.description || 'Payment failed. Your wallet was not charged.');
        setRazorpayBusy(false);
      });
      rzp.open();
      setRazorpayBusy(false);
    } catch (err) {
      setTopupMsg(err instanceof Error ? err.message : 'Could not start the payment');
      setRazorpayBusy(false);
    }
  }

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
          <div className="eyebrow">Your dashboard</div>
          <h2>Wallet &amp; orders</h2>
        </div>
        <button className="ghost-button" type="button" onClick={onBrowse}>Browse services</button>
      </div>
      {error && <div className="notice error">{error}</div>}

      <div className="dash-grid">
        <article className="panel">
          <h3>Wallet balance</h3>
          <div className="big-balance">{wallet ? formatMoney(wallet.balance, currency) : '…'}</div>
          {(config?.manualTopupsEnabled || config?.razorpayEnabled) && (
            <label>Amount (₹)<input type="number" inputMode="numeric" min={10} max={100000} required value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="100" /></label>
          )}
          {RAZORPAY_PARKED ? (
            <div className="instant-pay-box">
              <strong>⚡ Instant top-up — coming soon</strong>
              <p className="modal-sub">Cards, UPI and netbanking with automatic credit are on the way. For now, top up with manual UPI below.</p>
            </div>
          ) : config?.razorpayEnabled && (
            <div className="instant-pay-box">
              <strong>⚡ Instant top-up</strong>
              <p className="modal-sub">Pay by card, UPI or netbanking — your balance credits automatically, no waiting for verification.</p>
              <button className="primary-button full" type="button" onClick={payInstant} disabled={razorpayBusy || amount < 10}>
                {razorpayBusy ? 'Starting payment…' : `Pay ${amount >= 10 ? formatMoney(amount, currency) : ''} instantly`}
              </button>
            </div>
          )}
          {config?.manualTopupsEnabled ? (
            <>
              <ol className="steps-list">
                <li><strong>Pay</strong> — scan the QR or tap the button (any UPI app: GPay, PhonePe, Paytm).</li>
                <li><strong>Copy the UTR</strong> from the payment receipt (12-digit reference).</li>
                <li><strong>Submit it below</strong> — your balance lands after a quick verification.</li>
              </ol>
              <div className="upi-pay-box">
                <div className="upi-qr"><QRCodeSVG value={upiLink} size={140} /></div>
                <div className="upi-pay-side">
                  <span className="muted">You are paying</span>
                  <strong>{config.upiId}</strong>
                  <button type="button" className="ghost-button" onClick={copyUpiId}>{copied ? 'Copied ✓' : 'Copy UPI ID'}</button>
                  <a className="primary-button" href={upiLink}>Pay {amount >= 10 ? formatMoney(amount, currency) : ''} with UPI app</a>
                  <span className="muted">The QR and button follow the amount above.</span>
                </div>
              </div>
              <form onSubmit={submitTopup} className="form-stack">
                <label>UPI transaction reference (UTR)<input required value={txnRef} onChange={(e) => setTxnRef(e.target.value)} placeholder="e.g. 4321xxxxxxxx" /></label>
                <button className="primary-button full" type="submit">Request top-up</button>
              </form>
            </>
          ) : (
            !config?.razorpayEnabled && <p className="modal-sub">Top-ups open as soon as a payment method is configured.</p>
          )}
          {topupMsg && <div className="notice">{topupMsg}</div>}
          {!!wallet?.topups.length && (
            <div className="mini-list">
              <h4>Your top-up requests</h4>
              {wallet.topups.map((t) => (
                <div className="mini-row" key={t.id}><span>{formatMoney(t.amount, currency)}</span><span className={`status status-${t.status}`}>{t.status}</span><span className="muted">{formatDate(t.created_at)}</span></div>
              ))}
            </div>
          )}
        </article>

        <article className="panel">
          <h3>Recent wallet activity</h3>
          {!wallet?.transactions.length && <p className="modal-sub">Nothing yet.</p>}
          <div className="mini-list">
            {wallet?.transactions.map((t) => (
              <div className="mini-row" key={t.id}>
                <span className={t.amount >= 0 ? 'pos' : 'neg'}>{t.amount >= 0 ? '+' : ''}{formatMoney(t.amount, currency)}</span>
                <span>{t.note || t.type}</span>
                <span className="muted">{formatDate(t.created_at)}</span>
              </div>
            ))}
          </div>
        </article>
      </div>

      <article className="panel wide">
        <h3>Your orders</h3>
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
      </article>
    </main>
  );
}
