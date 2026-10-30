import { useMemo, useState } from 'react';
import { formatMoney, formatNumber } from '../lib/format';
import { chipLabel, shortService } from '../lib/shortTitle';
import type { Service } from '../types';

const MAX_RESULTS = 30;

interface Fit {
  service: Service;
  minCharge: number;
  maxUnits: number;
}

// "What can I get for ₹__?" — pure discovery over the already-loaded
// catalogue, no new API. A service fits when its minimum order charge
// (rate × minimum quantity) is within the budget; results rank by rate
// ascending, i.e. best value per rupee first, and each row shows the most
// units that budget actually buys (capped at the service maximum).
export function BudgetFinder({ services, currency, user, loading, onOrderClick }: {
  services: Service[];
  currency: string;
  user: boolean;
  loading: boolean;
  onOrderClick: (service: Service) => void;
}) {
  const [budgetText, setBudgetText] = useState('');
  const budget = Math.floor(Number(budgetText) || 0);

  const { fits, total } = useMemo(() => {
    if (budget <= 0) return { fits: [] as Fit[], total: 0 };
    const all: Fit[] = [];
    for (const service of services) {
      const rate = service.rate;
      const minCharge = rate > 0 ? (rate * service.min) / 1000 : 0;
      if (minCharge > budget) continue;
      const cap = service.max > 0 ? service.max : Infinity;
      const maxUnits = rate > 0 ? Math.min(cap, Math.floor((budget * 1000) / rate)) : cap;
      if (!Number.isFinite(maxUnits)) continue;
      all.push({ service, minCharge, maxUnits });
    }
    all.sort((a, b) => a.service.rate - b.service.rate);
    return { fits: all.slice(0, MAX_RESULTS), total: all.length };
  }, [services, budget]);

  return (
    <section className="budget-finder" aria-label="Budget finder">
      <div className="budget-finder-head">
        <div>
          <div className="eyebrow">Budget finder</div>
          <h3>What can I get for ₹…?</h3>
        </div>
        <label className="budget-input">
          <span>₹</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={budgetText}
            onChange={(event) => setBudgetText(event.target.value)}
            placeholder="50"
            aria-label="Your budget in rupees"
          />
        </label>
      </div>
      {budget <= 0 ? (
        <p className="muted">Type a budget above and see every service you can afford, best value first.</p>
      ) : loading ? (
        <p className="muted">Loading services…</p>
      ) : fits.length === 0 ? (
        <p className="muted">Nothing fits ₹{formatNumber(budget)} yet — try a slightly bigger budget.</p>
      ) : (
        <>
          <p className="muted">
            {total} service{total === 1 ? '' : 's'} fit in ₹{formatNumber(budget)}
            {total > fits.length ? ` — showing the best ${fits.length} first` : ' — best value first'}.
          </p>
          <ul className="budget-results">
            {fits.map(({ service, minCharge, maxUnits }) => (
              <li key={service.id} className="budget-row">
                <span className="platform-chip">{chipLabel(service)}</span>
                <span className="budget-row-name">{shortService(service).label}</span>
                <span className="muted">from {formatMoney(minCharge, currency)} · up to {formatNumber(maxUnits)} for ₹{formatNumber(budget)}</span>
                <button className="ghost-button" type="button" onClick={() => onOrderClick(service)}>
                  {user ? 'Order' : 'Log in to order'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
