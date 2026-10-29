import { useEffect, useState } from 'react';
import { getActivity } from '../api';
import { formatNumber } from '../lib/format';
import type { ActivityItem } from '../types';

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Storefront social proof: recent orders, anonymized by the API (service,
// quantity, status, time only — no users, links or order ids). Refreshes
// every minute so the section stays live. Any failure hides the section
// instead of breaking the landing page.
export function ActivityTicker() {
  const [items, setItems] = useState<ActivityItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => getActivity()
      .then((r) => { if (alive) setItems(r.activity); })
      .catch(() => { /* ticker never breaks the page */ });
    load();
    const timer = window.setInterval(load, 60000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <section className="how-section" id="activity">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Live activity</div>
          <h2>Happening on Ampliva right now.</h2>
        </div>
      </div>
      <ul className="activity-list">
        {items.map((item, i) => (
          <li key={`${item.createdAt}-${i}`}>
            <strong>{formatNumber(item.quantity)} × {item.service}</strong>
            <span className="muted">{item.status} · {timeAgo(item.createdAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
