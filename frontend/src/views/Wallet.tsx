import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { createRazorpayOrder, createTopup, getWallet } from '../api';
import { formatDate, formatMoney } from '../lib/format';
import type { PublicConfig, WalletResponse } from '../types';

// PARKED 2026-10-24: Razorpay instant payments run on test keys only until live KYC
// clears (physical PAN reprint -> Video KYC -> live keys). While parked, the wallet
// shows a Coming soon banner instead of the instant-pay box, so no customer can
// walk into a test-mode checkout. To resume: set this to false (live keys must be
// in the Worker secrets first).
const RAZORPAY_PARKED = true;

export function Wallet({ currency, config, onBalanceChange }: {
  currency: string;
  config: PublicConfig | null;
  onBalanceChange: (balance: number) => void;
}) {
  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Raw text state, parsed via `amount` — same leading-zero trap as quantity.
  const [amountText, setAmountText] = useState('100');
  const amount = Math.max(0, Math.floor(Number(amountText) || 0));
  // UPI caps one transaction at ₹1,00,000, and a number input's min/max
  // attributes don't stop typing or pasting — so clamp on every keystroke.
  // Empty string is preserved so the field stays clearable.
  const handleAmountChange = (raw: string) => {
    if (raw === '') { setAmountText(''); return; }
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n)) return;
    setAmountText(String(Math.min(100000, Math.max(0, n))));
  };
  const [txnRef, setTxnRef] = useState('');
  const [topupMsg, setTopupMsg] = useState<string | null>(null);
  const [razorpayBusy, setRazorpayBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qrFlash, setQrFlash] = useState(false);

  const upiLink = config?.upiId
    ? `upi://pay?pa=${encodeURIComponent(config.upiId)}&pn=${encodeURIComponent('Arppith Andrews')}&cu=INR&tn=${encodeURIComponent('Ampliva wallet top-up')}${amount >= 10 ? `&am=${amount}` : ''}`
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

  // Fallback for UPI apps that reject browser-originated intents (seen 2026-10-28:
  // Supermoney + GPay failed the button while QR/manual worked): point at the QR
  // that is already on screen, so a failed button tap still ends in a payment.
  function flashQr() {
    document.querySelector('.upi-qr')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setQrFlash(true);
    window.setTimeout(() => setQrFlash(false), 1800);
  }

  const load = useCallback(async () => {
    try {
      const w = await getWallet();
      setWallet(w);
      onBalanceChange(w.balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load wallet');
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

  return (
    <main className="dash">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Account</div>
          <h2>Wallet</h2>
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}

      <div className="dash-grid">
        <article className="panel">
          <h3>Wallet balance</h3>
          <div className="big-balance">{wallet ? formatMoney(wallet.balance, currency) : '…'}</div>
          {/* Amount field lives in the manual UPI flow (styled like the UTR
              field) so it sits next to the QR and button it controls. When
              manual top-ups are off but instant pay is on, it renders here
              instead so the instant button still has an amount to charge. */}
          {!config?.manualTopupsEnabled && config?.razorpayEnabled && (
            <div className="form-stack">
              <label>Amount (₹)<input type="number" inputMode="numeric" min={10} max={100000} required value={amountText} onChange={(e) => handleAmountChange(e.target.value)} placeholder="100" /></label>
            </div>
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
              <div className="form-stack">
                <label>Amount (₹)<input type="number" inputMode="numeric" min={10} max={100000} required value={amountText} onChange={(e) => handleAmountChange(e.target.value)} placeholder="100" /></label>
                <span className="muted">UPI limit: ₹10 – ₹1,00,000 per top-up.</span>
              </div>
              <div className="upi-pay-box">
                <div className={qrFlash ? 'upi-qr flash' : 'upi-qr'}><QRCodeSVG value={upiLink} size={140} /></div>
                <div className="upi-pay-side">
                  <span className="muted">You are paying</span>
                  <strong>{config.upiId}</strong>
                  <button type="button" className="ghost-button" onClick={copyUpiId}>{copied ? 'Copied ✓' : 'Copy UPI ID'}</button>
                  <a className="primary-button" href={upiLink}>Pay {amount >= 10 ? formatMoney(amount, currency) : ''} with UPI app</a>
                  <button type="button" className="ghost-button" onClick={flashQr}>Button failing? Scan the QR instead</button>
                  <span className="muted">The QR and button follow the amount you enter above.</span>
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
    </main>
  );
}
