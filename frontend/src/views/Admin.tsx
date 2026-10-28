import { useCallback, useEffect, useState } from 'react';
import {
  adminApproveTopup,
  adminOrders,
  adminRegisterDiscordCommands,
  adminRejectTopup,
  adminServices as fetchAdminServices,
  adminStats,
  adminSync,
  adminTopups as fetchAdminTopups,
  adminUpdateService,
} from '../api';
import { formatDate, formatMoney, formatNumber, formatOrderRef } from '../lib/format';
import type { AdminService, AdminStats, Order, PaymentRequest } from '../types';

export function Admin({ currency }: { currency: string }) {
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

  async function registerDiscord() {
    setMsg(null);
    try {
      const result = await adminRegisterDiscordCommands();
      setMsg(`Discord commands registered: ${result.count} commands. Try /pending in your server.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
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
          <article><strong>{stats.orders}</strong><span>orders</span><span>{stats.successfulOrders} completed · {stats.failedOrders} canceled</span></article>
          <article><strong>{formatMoney(stats.revenue, currency)}</strong><span>revenue</span></article>
          <article><strong>{formatMoney(stats.grossMargin, currency)}</strong><span>gross margin</span></article>
          <article><strong>{stats.providerBalance === null ? '—' : formatMoney(stats.providerBalance, currency)}</strong><span>CID balance</span></article>
          <article><strong>{stats.pendingTopups}</strong><span>pending top-ups</span></article>
        </div>
      )}

      <article className="panel wide">
        <h3>Discord bot</h3>
        <p className="modal-sub">Registers /pending, /users, /adjust, /orders, /refills and /inspect in your Discord server (guild-scoped, instant). Needs DISCORD_APP_ID and DISCORD_GUILD_ID in the Worker first.</p>
        <button className="primary-button" type="button" onClick={registerDiscord}>Register bot commands</button>
      </article>

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
            <thead><tr><th>Order</th><th>When</th><th>Customer</th><th>Service</th><th>Qty</th><th>Charge</th><th>Cost</th><th>Status</th><th>Inputs</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{formatOrderRef(o.id, o.order_number)}</td>
                  <td>{formatDate(o.created_at)}</td>
                  <td>{o.user_email || o.user_id}</td>
                  <td>{o.service_name}</td>
                  <td>{formatNumber(o.quantity)}</td>
                  <td>{formatMoney(o.charge, currency)}</td>
                  <td>{formatMoney(o.provider_cost, currency)}</td>
                  <td>{o.status}</td>
                  <td>{o.extras
                    ? <span title={o.extras.slice(0, 1000)}>{o.extras.slice(0, 120)}{o.extras.length > 120 ? '…' : ''}</span>
                    : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </main>
  );
}
