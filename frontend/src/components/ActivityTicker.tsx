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

// Provider names bury the point in marketing detail after a '·' separator
// ("Instagram Views Max Unlimited · All Links · ..."); the banner shows
// only the first segment, which matches the store listing and keeps each
// entry short enough to read while it rolls past.
function bannerService(name: string): string {
  return name.split(/[·|]/)[0].trim() || name;
}

// News-bulletin banner: one continuously rolling line, anonymized by the
// API (service, quantity, status, time only — no users, links or order
// ids). The track holds two copies of the entries and slides exactly one
// copy's width, so the loop is seamless; each entry carries its own
// trailing margin so the -50% shift lands exactly. Refreshes every minute;
// any failure hides the banner instead of breaking the landing page.
// Pauses on hover; reduced-motion users get a plain scrollable strip.
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

  const entries = [...items, ...items];

  return (
    <section className="activity-banner" aria-label="Recent orders">
      <span className="activity-banner-label"><span className="activity-live-dot" />Live</span>
      <div className="activity-marquee">
        <div className="activity-track">
          {entries.map((item, i) => (
            <span className="activity-entry" key={`${item.createdAt}-${i}`}>
              <strong>{formatNumber(item.quantity)} × {bannerService(item.service)}</strong>
              <span className="muted"> · {item.status} · {timeAgo(item.createdAt)}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
