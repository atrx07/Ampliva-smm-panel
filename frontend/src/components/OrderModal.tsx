import { useState } from 'react';
import { createOrder } from '../api';
import { formatMoney, formatNumber } from '../lib/format';
import type { Service } from '../types';

export function OrderModal({ service, currency, balance, onClose, onOrdered }: {
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
