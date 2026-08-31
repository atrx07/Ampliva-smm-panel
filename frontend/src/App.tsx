import { useEffect, useMemo, useState } from 'react';
import { getServices } from './api';
import type { Platform, Service, ServicesResponse } from './types';

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

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function App() {
  const [catalog, setCatalog] = useState<ServicesResponse | null>(null);
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState<Platform | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getServices()
      .then(setCatalog)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load services'))
      .finally(() => setLoading(false));
  }, []);

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

  return (
    <div className="app-shell">
      <header className="nav-wrap">
        <a className="brand" href="#top" aria-label="Ampliva home">
          <span className="brand-mark">A</span>
          <span>Ampliva</span>
        </a>
        <nav>
          <a href="#services">Services</a>
          <a href="#how">How it works</a>
          <button className="ghost-button" type="button" disabled>Dashboard soon</button>
        </nav>
      </header>

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
            <span className="microcopy">Checkout and order tracking are the next milestone.</span>
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
                    <strong>{formatMoney(service.rate, catalog?.currency ?? 'INR')}</strong>
                    <span>/ 1K</span>
                  </div>
                  <div className="limits">
                    <span><small>Minimum</small>{formatNumber(service.min)}</span>
                    <span><small>Maximum</small>{formatNumber(service.max)}</span>
                  </div>
                  <button className="service-button" type="button" disabled>Select · soon</button>
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
              <div className="eyebrow">How Ampliva will work</div>
              <h2>Three steps. No provider-side chaos.</h2>
            </div>
          </div>
          <div className="steps">
            <article><span>01</span><h3>Choose</h3><p>Pick a service with clear pricing, minimums and maximums.</p></article>
            <article><span>02</span><h3>Pay</h3><p>Checkout happens through Ampliva before any provider order is created.</p></article>
            <article><span>03</span><h3>Track</h3><p>Ampliva follows fulfillment status and keeps the provider integration behind the scenes.</p></article>
          </div>
        </section>
      </main>

      <footer>
        <div className="brand"><span className="brand-mark">A</span><span>Ampliva</span></div>
        <p>Promotional services should be represented accurately and never presented as guaranteed organic growth.</p>
      </footer>
    </div>
  );
}

export default App;
