import { useCallback, useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  adminApproveTopup,
  adminOrders,
  adminRejectTopup,
  adminServices as fetchAdminServices,
  adminStats,
  adminTopups as fetchAdminTopups,
  adminSync,
  adminUpdateService,
  cancelOrder,
  createOrder,
  createRazorpayOrder,
  createTopup,
  getConfig,
  getMe,
  getOrders,
  getServices,
  getToken,
  getWallet,
  login,
  logout as apiLogout,
  refillOrder,
  refreshOrder,
  register,
  setToken,
} from './api';
import type {
  AdminService,
  AdminStats,
  AuthUser,
  Order,
  PaymentRequest,
  Platform,
  PublicConfig,
  Service,
  ServicesResponse,
  WalletResponse,
} from './types';

const platformLabels: Record<Platform | 'all', string> = {
  all: 'All services',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  telegram: 'Telegram',
  x: 'X',
  other: 'Other',
};

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-IN', { notation: value >= 100000 ? 'compact' : 'standard' }).format(value);
}

function formatMoney(value: number, currency = 'INR') {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

type View = 'shop' | 'dashboard' | 'admin';

function App() {
  const [catalog, setCatalog] = useState<ServicesResponse | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState<Platform | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [user, setUser] = useState<AuthUser | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [view, setView] = useState<View>('shop');
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

  const services = catalog?.services ?? [];

  const visibleServices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return services.filter((service) => {
      const matchesPlatform = platform === 'all' || service.platform === platform;
      const matchesQuery = !needle || `${service.name} ${service.category}`.toLowerCase().includes(needle);
      return matchesPlatform && matchesQuery;
    });
  }, [platform, query, services]);

  const availablePlatforms = useMemo(() => {
    const discovered = new Set(services.map((service) => service.platform));
    return (Object.keys(platformLabels) as Array<Platform | 'all'>).filter(
      (item) => item === 'all' || discovered.has(item),
    );
  }, [services]);

  async function handleLogout() {
    try { await apiLogout(); } catch { /* token cleared regardless */ }
    setToken(null);
    setUser(null);
    setBalance(null);
    setView('shop');
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

  return (
    <div className="app-shell">
      <header className="nav-wrap">
        <a className="brand" href="#top" aria-label="Ampliva home" onClick={() => setView('shop')}>
          <span className="brand-mark">A</span>
          <span>Ampliva</span>
        </a>
        <nav>
          <a href="#services" onClick={() => setView('shop')}>Services</a>
          <a href="#how" onClick={() => setView('shop')}>How it works</a>
          {user ? (
            <>
              <span className="balance-chip">{formatMoney(balance ?? 0, currency)}</span>
              <button className="ghost-button" type="button" onClick={() => setView('dashboard')}>Dashboard</button>
              {user.role === 'admin' && (
                <button className="ghost-button" type="button" onClick={() => setView('admin')}>Admin</button>
              )}
              <button className="ghost-button" type="button" onClick={handleLogout}>Log out</button>
            </>
          ) : (
            <button className="ghost-button" type="button" onClick={() => setAuthOpen(true)}>Log in / Sign up</button>
          )}
        </nav>
      </header>

      {notice && <div className="notice top-notice">{notice} <button className="link-button" onClick={() => setNotice(null)}>Dismiss</button></div>}

      {view === 'dashboard' && user && (
        <Dashboard
          currency={currency}
          config={config}
          onBalanceChange={setBalance}
          onBrowse={() => setView('shop')}
        />
      )}

      {view === 'admin' && user?.role === 'admin' && <Admin currency={currency} />}

      {view === 'shop' && (
        <main id="top">
          <section className="hero">
            <div className="eyebrow">A cleaner way to manage promotional reach</div>
            <h1>Amplify your reach.<br /><span>Keep the process simple.</span></h1>
            <p className="hero-copy">
              Browse promotional services through one clean storefront, with transparent limits,
              refill indicators and pricing before you order.
            </p>
            <div className="hero-actions">
              <a className="primary-button" href="#services">Explore services</a>
              <span className="microcopy">{config?.orderingEnabled ? 'Live ordering is on — top up your wallet and order in minutes.' : 'Live ordering switches on with the provider connection.'}</span>
            </div>
            <div className="hero-grid" aria-label="Ampliva highlights">
              <article><strong>{services.length || '—'}</strong><span>services loaded</span></article>
              <article><strong>₹0</strong><span>platform subscription</span></article>
              <article><strong>24/7</strong><span>catalogue access</span></article>
            </div>
          </section>

          <section className="catalog-section" id="services">
            <div className="section-heading">
              <div>
                <div className="eyebrow">Service catalogue</div>
                <h2>Find what you need without the panel clutter.</h2>
              </div>
              {catalog && (
                <div className={`source-pill source-${catalog.source}`}>
                  <span className="status-dot" />
                  {catalog.source === 'live' ? 'Live catalogue' : 'Preview catalogue'}
                </div>
              )}
            </div>

            <div className="catalog-controls">
              <label className="search-field">
                <span>⌕</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search services or categories"
                  aria-label="Search services"
                />
              </label>
              <div className="platform-tabs" aria-label="Filter by platform">
                {availablePlatforms.map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={platform === item ? 'active' : ''}
                    onClick={() => setPlatform(item)}
                  >
                    {platformLabels[item]}
                  </button>
                ))}
              </div>
            </div>

            {catalog?.warning && <div className="notice">{catalog.warning}</div>}
            {error && <div className="notice error">{error}. Start the Worker locally or set VITE_API_URL.</div>}

            {loading ? (
              <div className="service-grid" aria-label="Loading services">
                {Array.from({ length: 6 }).map((_, index) => <div className="service-card skeleton" key={index} />)}
              </div>
            ) : (
              <div className="service-grid">
                {visibleServices.map((service: Service) => (
                  <article className="service-card" key={service.id}>
                    <div className="card-topline">
                      <span className="platform-chip">{platformLabels[service.platform]}</span>
                      {service.refill && <span className="refill-chip">Refill</span>}
                    </div>
                    <h3>{service.name}</h3>
                    <p className="category">{service.category}</p>
                    <div className="price-row">
                      <strong>{formatMoney(service.rate, currency)}</strong>
                      <span>/ 1K</span>
                    </div>
                    <div className="limits">
                      <span><small>Minimum</small>{formatNumber(service.min)}</span>
                      <span><small>Maximum</small>{formatNumber(service.max)}</span>
                    </div>
                    <button className="service-button active-button" type="button" onClick={() => handleOrderClick(service)}>
                      {user ? 'Order now' : 'Log in to order'}
                    </button>
                  </article>
                ))}
                {!visibleServices.length && !error && (
                  <div className="empty-state">No services match that search yet.</div>
                )}
              </div>
            )}
          </section>

          <section className="how-section" id="how">
            <div className="section-heading">
              <div>
                <div className="eyebrow">How Ampliva works</div>
                <h2>Three steps. No provider-side chaos.</h2>
              </div>
            </div>
            <div className="steps">
              <article><span>01</span><h3>Top up</h3><p>Add funds to your Ampliva wallet with UPI. Your balance is credited once the payment is verified.</p></article>
              <article><span>02</span><h3>Order</h3><p>Pick a service, paste your link, choose a quantity. The exact price is shown before you confirm.</p></article>
              <article><span>03</span><h3>Track</h3><p>Follow delivery from your dashboard, with refill and cancel options where the service supports them.</p></article>
            </div>
          </section>
        </main>
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
            setView('dashboard');
          }}
        />
      )}
    </div>
  );
}

function AuthModal({ onClose, onAuthed }: { onClose: () => void; onAuthed: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = mode === 'register' ? await register(email, password) : await login(email, password);
      setToken(result.token);
      onAuthed(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{mode === 'register' ? 'Create your account' : 'Welcome back'}</h3>
        <p className="modal-sub">One account for your wallet, orders and tracking.</p>
        <form onSubmit={submit} className="form-stack">
          <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          <label>Password<input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" /></label>
          {error && <div className="notice error">{error}</div>}
          <button className="primary-button full" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Sign up' : 'Log in'}</button>
        </form>
        <button className="link-button" onClick={() => setMode(mode === 'register' ? 'login' : 'register')}>
          {mode === 'register' ? 'Already have an account? Log in' : 'New here? Create an account'}
        </button>
      </div>
    </div>
  );
}

function OrderModal({ service, currency, balance, onClose, onOrdered }: {
  service: Service;
  currency: string;
  balance: number;
  onClose: () => void;
  onOrdered: (newBalance: number) => void;
}) {
  const [link, setLink] = useState('');
  // Keep the raw text in state and parse for math: a numeric state turns an
  // emptied field into a stuck leading "0" the user can never backspace away.
  const [quantityText, setQuantityText] = useState(String(service.min || 100));
  const quantity = Math.max(0, Math.floor(Number(quantityText) || 0));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const charge = Math.round(((service.rate * quantity) / 1000) * 100) / 100;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await createOrder(service.id, link, quantity);
      onOrdered(result.balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{service.name}</h3>
        <p className="modal-sub">{formatMoney(service.rate, currency)} / 1K · Min {formatNumber(service.min)} · Max {formatNumber(service.max)}</p>
        <form onSubmit={submit} className="form-stack">
          <label>Link to promote<input required value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://instagram.com/…" /></label>
          <label>Quantity<input required type="number" inputMode="numeric" min={service.min} max={service.max} value={quantityText} onChange={(e) => setQuantityText(e.target.value)} placeholder={String(service.min)} /></label>
          <div className="charge-row">
            <span>Total charge</span><strong>{formatMoney(charge, currency)}</strong>
          </div>
          <div className="charge-row muted-row">
            <span>Your balance</span><span>{formatMoney(balance, currency)}</span>
          </div>
          {balance < charge && <div className="notice error">Insufficient balance — top up from your dashboard first.</div>}
          {error && <div className="notice error">{error}</div>}
          <button className="primary-button full" type="submit" disabled={busy || balance < charge}>{busy ? 'Placing order…' : 'Confirm order'}</button>
        </form>
      </div>
    </div>
  );
}

function Dashboard({ currency, config, onBalanceChange, onBrowse }: {
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
          {config?.razorpayEnabled && (
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

function Admin({ currency }: { currency: string }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [adminServices, setAdminServices] = useState<AdminService[]>([]);
  const [topups, setTopups] = useState<PaymentRequest[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [svcQuery, setSvcQuery] = useState('');
  const [edits, setEdits] = useState<Record<string, { name: string; markup: string }>>({});

  const load = useCallback(async () => {
    try {
      const [s, sv, t, o] = await Promise.all([adminStats(), fetchAdminServices(), fetchAdminTopups(), adminOrders()]);
      setStats(s);
      setAdminServices(sv.services);
      setTopups(t.topups);
      setOrders(o.orders);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load admin data');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function doSync() {
    setMsg(null);
    try {
      const result = await adminSync();
      setMsg(`Catalogue synced: ${result.serviceCount} live services.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    }
  }

  async function decideTopup(id: string, approve: boolean) {
    try {
      if (approve) await adminApproveTopup(id); else await adminRejectTopup(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision failed');
    }
  }

  async function saveService(service: AdminService) {
    const edit = edits[service.id];
    try {
      await adminUpdateService(service.id, {
        displayName: edit ? (edit.name.trim() || null) : undefined,
        markupPercent: edit && edit.markup !== '' ? Number(edit.markup) : undefined,
      });
      setMsg(`Saved ${service.id}.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function toggleService(service: AdminService) {
    try {
      await adminUpdateService(service.id, { isActive: service.is_active !== 1 });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed');
    }
  }

  const visibleAdminServices = adminServices.filter((s) =>
    `${s.provider_name} ${s.category}`.toLowerCase().includes(svcQuery.trim().toLowerCase()),
  ).slice(0, 100);

  return (
    <main className="dash">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Admin</div>
          <h2>Run the panel</h2>
        </div>
        <button className="primary-button" type="button" onClick={doSync}>Sync catalogue from CID</button>
      </div>
      {error && <div className="notice error">{error}</div>}
      {msg && <div className="notice">{msg}</div>}

      {stats && (
        <div className="stat-grid">
          <article><strong>{stats.users}</strong><span>users</span></article>
          <article><strong>{stats.activeServices}</strong><span>active services</span></article>
          <article><strong>{stats.orders}</strong><span>orders</span></article>
          <article><strong>{formatMoney(stats.revenue, currency)}</strong><span>revenue</span></article>
          <article><strong>{formatMoney(stats.grossMargin, currency)}</strong><span>gross margin</span></article>
          <article><strong>{stats.providerBalance === null ? '—' : formatMoney(stats.providerBalance, currency)}</strong><span>CID balance</span></article>
          <article><strong>{stats.pendingTopups}</strong><span>pending top-ups</span></article>
        </div>
      )}

      <article className="panel wide">
        <h3>Top-up requests</h3>
        {!topups.length && <p className="modal-sub">None yet.</p>}
        <div className="mini-list">
          {topups.map((t) => (
            <div className="mini-row" key={t.id}>
              <span>{formatMoney(t.amount, currency)}</span>
              <span>{t.user_email || t.user_id} · UTR {t.txn_ref}</span>
              <span className={`status status-${t.status}`}>{t.status}</span>
              {t.status === 'pending' && (
                <span className="row-actions">
                  <button onClick={() => decideTopup(t.id, true)}>Approve</button>
                  <button onClick={() => decideTopup(t.id, false)}>Reject</button>
                </span>
              )}
            </div>
          ))}
        </div>
      </article>

      <article className="panel wide">
        <h3>Services ({adminServices.length})</h3>
        <label className="search-field"><span>⌕</span><input value={svcQuery} onChange={(e) => setSvcQuery(e.target.value)} placeholder="Filter services" /></label>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Display name</th><th>Provider rate</th><th>Markup %</th><th>Retail</th><th>Visible</th><th></th></tr></thead>
            <tbody>
              {visibleAdminServices.map((s) => {
                const edit = edits[s.id] ?? { name: s.display_name || '', markup: s.markup_override?.toString() || '' };
                return (
                  <tr key={s.id}>
                    <td>
                      <input className="cell-input" value={edit.name} placeholder={s.provider_name}
                        onChange={(e) => setEdits({ ...edits, [s.id]: { ...edit, name: e.target.value } })} />
                      <div className="muted small">{s.category} · {s.provider_active ? 'live' : 'gone upstream'}</div>
                    </td>
                    <td>{formatMoney(s.provider_rate, currency)}</td>
                    <td><input className="cell-input narrow" value={edit.markup} placeholder="35"
                      onChange={(e) => setEdits({ ...edits, [s.id]: { ...edit, markup: e.target.value } })} /></td>
                    <td>{formatMoney(s.retail_rate, currency)}</td>
                    <td><button onClick={() => toggleService(s)}>{s.is_active ? 'Visible' : 'Hidden'}</button></td>
                    <td><button onClick={() => saveService(s)}>Save</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel wide">
        <h3>All orders</h3>
        {!orders.length && <p className="modal-sub">No orders yet.</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Customer</th><th>Service</th><th>Qty</th><th>Charge</th><th>Cost</th><th>Status</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{formatDate(o.created_at)}</td>
                  <td>{o.user_email || o.user_id}</td>
                  <td>{o.service_name}</td>
                  <td>{formatNumber(o.quantity)}</td>
                  <td>{formatMoney(o.charge, currency)}</td>
                  <td>{formatMoney(o.provider_cost, currency)}</td>
                  <td>{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </main>
  );
}

export default App;
