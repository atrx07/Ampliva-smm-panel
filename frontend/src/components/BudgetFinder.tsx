import { useMemo, useState } from 'react';
import { displayCategory, sortCategories } from '../lib/categories';
import { formatMoney, formatNumber, platformLabels } from '../lib/format';
import { chipLabel, shortService } from '../lib/shortTitle';
import type { Platform, Service } from '../types';

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
  const [platform, setPlatform] = useState<Platform | 'all'>('all');
  const [category, setCategory] = useState('all');
  const budget = Math.floor(Number(budgetText) || 0);

  // Same discovery as the main store list: only platforms actually present,
  // categories scoped to the chosen platform.
  const availablePlatforms = useMemo(() => {
    const discovered = new Set(services.map((service) => service.platform));
    return (Object.keys(platformLabels) as Platform[]).filter((item) => discovered.has(item));
  }, [services]);

  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const service of services) {
      if (platform === 'all' || service.platform === platform) names.add(displayCategory(service.category));
    }
    return sortCategories([...names]);
  }, [services, platform]);

  function pickPlatform(item: Platform | 'all') {
    setPlatform(item);
    setCategory('all');
  }

  const scope = [platform !== 'all' ? platformLabels[platform] : null, category !== 'all' ? category : null]
    .filter(Boolean).join(' · ');

  const { fits, total } = useMemo(() => {
    if (budget <= 0) return { fits: [] as Fit[], total: 0 };
    const all: Fit[] = [];
    for (const service of services) {
      if (platform !== 'all' && service.platform !== platform) continue;
      if (category !== 'all' && displayCategory(service.category) !== category) continue;
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
  }, [services, budget, platform, category]);

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
      <div className="budget-filters">
        <label className="select-field">
          <span>Platform</span>
          <select value={platform} onChange={(event) => pickPlatform(event.target.value as Platform | 'all')} aria-label="Filter budget results by platform">
            <option value="all">All platforms</option>
            {availablePlatforms.map((item) => (
              <option key={item} value={item}>{platformLabels[item]}</option>
            ))}
          </select>
        </label>
        <label className="select-field">
          <span>Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter budget results by category">
            <option value="all">All categories</option>
            {categories.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
      </div>
      {budget <= 0 ? (
        <p className="muted">Type a budget above and see every service you can afford, best value first.</p>
      ) : loading ? (
        <p className="muted">Loading services…</p>
      ) : fits.length === 0 ? (
        <p className="muted">Nothing fits ₹{formatNumber(budget)}{scope ? ` in ${scope}` : ''} yet — try a slightly bigger budget or a different filter.</p>
      ) : (
        <>
          <p className="muted">
            {total} service{total === 1 ? '' : 's'}{scope ? ` in ${scope}` : ''} fit in ₹{formatNumber(budget)}
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
