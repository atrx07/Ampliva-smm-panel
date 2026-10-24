import { useEffect, useState } from 'react';
import { getRefills } from '../api';
import { formatDate } from '../lib/format';
import type { RefillRequest } from '../types';

// Refill history, recorded from migration 0004 onward. Refills requested
// before that migration were never stored and cannot be recovered, so the
// history starts with the first refill after it.
export function Refills() {
  const [refills, setRefills] = useState<RefillRequest[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRefills()
      .then((r) => setRefills(r.refills))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load refill history'));
  }, []);

  const statusLabel = (status: string) => {
    if (status === 'submitted') return 'Sent to provider';
    if (status === 'failed') return 'Failed';
    return 'Pending';
  };

  return (
    <main className="dash">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Account</div>
          <h2>Refill history</h2>
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}
      <article className="panel wide">
        {!refills.length && <p className="modal-sub">No refills yet — refills you request from your order history will show up here.</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Service</th><th>Link</th><th>Requested</th><th>Provider refill ID</th><th>Status</th></tr></thead>
            <tbody>
              {refills.map((r) => (
                <tr key={r.id}>
                  <td>{r.service_name}</td>
                  <td className="link-cell"><a href={r.link} target="_blank" rel="noreferrer">{r.link}</a></td>
                  <td>{formatDate(r.created_at)}</td>
                  <td>{r.provider_refill_id ?? '—'}</td>
                  <td>{statusLabel(r.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </main>
  );
}
