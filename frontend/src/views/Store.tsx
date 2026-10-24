import { useMemo, useState } from 'react';
import { displayCategory, sortCategories } from '../lib/categories';
import { FEATURED_IDS } from '../lib/featured';
import { formatMoney, formatNumber, platformLabels } from '../lib/format';
import type { Platform, Service, ServicesResponse } from '../types';

type SortKey = 'featured' | 'price-asc' | 'price-desc' | 'min-asc';

const SORT_LABELS: Record<SortKey, string> = {
  featured: 'Featured first',
  'price-asc': 'Price: low to high',
  'price-desc': 'Price: high to low',
  'min-asc': 'Minimum: low to high',
};

// Best-effort type badge from the service name ("Views", "Likes", ...).
// First keyword wins; names that match nothing fall back to "Service".
const TYPE_KEYWORDS: Array<[string, string]> = [
  ['subscriber', 'Subscribers'],
  ['follower', 'Followers'],
  ['member', 'Members'],
  ['like', 'Likes'],
  ['view', 'Views'],
  ['comment', 'Comments'],
  ['share', 'Shares'],
  ['reaction', 'Reactions'],
  ['impression', 'Impressions'],
  ['reach', 'Reach'],
  ['save', 'Saves'],
  ['download', 'Downloads'],
  ['vote', 'Votes'],
  ['traffic', 'Traffic'],
  ['boost', 'Boost'],
  ['watch', 'Watch time'],
];

function serviceType(name: string): string {
  const lower = name.toLowerCase();
  for (const [keyword, label] of TYPE_KEYWORDS) {
    if (lower.includes(keyword)) return label;
  }
  return 'Service';
}

// Compact accordion row: a one-line banner (platform, name, type, price)
// that expands into the full details + buy button. The page holds a single
// openId, so expanding one row always collapses whatever was open.
function ServiceRow({ service, currency, user, open, onToggle, onOrderClick }: {
  service: Service;
  currency: string;
  user: boolean;
  open: boolean;
  onToggle: () => void;
  onOrderClick: (service: Service) => void;
}) {
  return (
    <article className={`service-row${open ? ' open' : ''}`}>
      <button type="button" className="service-row-head" onClick={onToggle} aria-expanded={open}>
        <span className="platform-chip">{platformLabels[service.platform]}</span>
        <span className="row-name">{service.name}</span>
        <span className="type-chip">{serviceType(service.name)}</span>
        <span className="row-price"><strong>{formatMoney(service.rate, currency)}</strong><span> /1K</span></span>
        <span className="row-chevron" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="service-row-body">
          <h3>{service.name}</h3>
          <p className="category">{displayCategory(service.category)}</p>
          {service.refill && <span className="refill-chip">Refill</span>}
          <div className="limits">
            <span><small>Minimum</small>{formatNumber(service.min)}</span>
            <span><small>Maximum</small>{formatNumber(service.max)}</span>
          </div>
          <button className="service-button active-button" type="button" onClick={() => onOrderClick(service)}>
            {user ? 'Order now' : 'Log in to order'}
          </button>
        </div>
      )}
    </article>
  );
}

export function Store({ catalog, loading, error, user, currency, onOrderClick }: {
  catalog: ServicesResponse | null;
  loading: boolean;
  error: string | null;
  user: boolean;
  currency: string;
  onOrderClick: (service: Service) => void;
}) {
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState<Platform | 'all'>('all');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<SortKey>('featured');
  const [openId, setOpenId] = useState<string | null>(null);

  const services = catalog?.services ?? [];

  const availablePlatforms = useMemo(() => {
    const discovered = new Set(services.map((service) => service.platform));
    return (Object.keys(platformLabels) as Array<Platform | 'all'>).filter(
      (item) => item === 'all' || discovered.has(item),
    );
  }, [services]);

  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const service of services) {
      if (platform === 'all' || service.platform === platform) names.add(displayCategory(service.category));
    }
    return sortCategories([...names]);
  }, [services, platform]);

  const featured = useMemo(() => {
    const byId = new Map(services.map((service) => [service.id, service]));
    return FEATURED_IDS.map((id) => byId.get(id)).filter((s): s is Service => Boolean(s));
  }, [services]);

  const showFeatured = platform === 'all' && category === 'all' && query.trim() === '';

  const visibleServices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = services.filter((service) => {
      const matchesPlatform = platform === 'all' || service.platform === platform;
      const matchesCategory = category === 'all' || displayCategory(service.category) === category;
      const matchesQuery = !needle || `${service.name} ${service.category} ${displayCategory(service.category)}`.toLowerCase().includes(needle);
      return matchesPlatform && matchesCategory && matchesQuery;
    });
    const rank = new Map(FEATURED_IDS.map((id, index) => [id, index]));
    return [...filtered].sort((a, b) => {
      if (sort === 'price-asc') return a.rate - b.rate;
      if (sort === 'price-desc') return b.rate - a.rate;
      if (sort === 'min-asc') return a.min - b.min;
      const ra = rank.has(a.id) ? rank.get(a.id)! : 1000;
      const rb = rank.has(b.id) ? rank.get(b.id)! : 1000;
      return ra !== rb ? ra - rb : a.rate - b.rate;
    });
  }, [platform, category, query, services, sort]);

  function pickPlatform(item: Platform | 'all') {
    setPlatform(item);
    setCategory('all');
    setOpenId(null);
  }

  function pickCategory(name: string) {
    setCategory(name);
    setOpenId(null);
  }

  function toggleRow(id: string) {
    setOpenId((current) => (current === id ? null : id));
  }

  return (
    <main>
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
                onClick={() => pickPlatform(item)}
              >
                {platformLabels[item]}
              </button>
            ))}
          </div>
          <div className="store-toolbar">
            <label className="select-field">
              <span>Category</span>
              <select value={category} onChange={(event) => pickCategory(event.target.value)} aria-label="Filter by category">
                <option value="all">All categories</option>
                {categories.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="select-field">
              <span>Sort</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Sort services">
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <option key={key} value={key}>{SORT_LABELS[key]}</option>
                ))}
              </select>
            </label>
            <span className="result-count">{loading ? 'Loading…' : `${visibleServices.length} service${visibleServices.length === 1 ? '' : 's'}`}</span>
          </div>
        </div>

        {catalog?.warning && <div className="notice">{catalog.warning}</div>}
        {error && <div className="notice error">{error}. Start the Worker locally or set VITE_API_URL.</div>}

        {loading ? (
          <div className="service-list" aria-label="Loading services">
            {Array.from({ length: 6 }).map((_, index) => <div className="service-row skeleton" key={index} />)}
          </div>
        ) : (
          <>
            {showFeatured && featured.length > 0 && (
              <section className="featured-section" aria-label="Featured services">
                <h3>⭐ Featured</h3>
                <p className="modal-sub">The services most customers start with — clear names, sane minimums, refill where it matters.</p>
                <div className="service-list">
                  {featured.map((service) => (
                    <ServiceRow key={service.id} service={service} currency={currency} user={user} open={openId === service.id} onToggle={() => toggleRow(service.id)} onOrderClick={onOrderClick} />
                  ))}
                </div>
              </section>
            )}
            <div className="service-list">
              {visibleServices.map((service: Service) => (
                <ServiceRow key={service.id} service={service} currency={currency} user={user} open={openId === service.id} onToggle={() => toggleRow(service.id)} onOrderClick={onOrderClick} />
              ))}
              {!visibleServices.length && !error && (
                <div className="empty-state">No services match that search yet.</div>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
