import { useState } from 'react';
import { createOrder } from '../api';
import { formatMoney, formatNumber } from '../lib/format';
import { linkField, nonEmptyLines, orderFormConfig } from '../lib/orderFields';
import type { Service } from '../types';

export function OrderModal({ service, currency, balance, onClose, onOrdered }: {
  service: Service;
  currency: string;
  balance: number;
  onClose: () => void;
  onOrdered: (newBalance: number) => void;
}) {
  // The form is type-driven (audit 2026-10-25): most services need only
  // link + quantity, but Custom Comments need a comments textarea,
  // Poll needs an answer number, dripfeed services need runs/interval,
  // and Package services have a fixed quantity. The backend re-validates
  // all of this; this is the customer-facing half.
  const config = orderFormConfig(service);
  const field = linkField(service);

  const [link, setLink] = useState('');
  // Keep the raw text in state and parse for math: a numeric state turns an
  // emptied field into a stuck leading "0" the user can never backspace away.
  const [quantityText, setQuantityText] = useState(String(service.min || 100));
  const [comments, setComments] = useState('');
  const [usernames, setUsernames] = useState('');
  const [donorUsername, setDonorUsername] = useState('');
  const [hashtag, setHashtag] = useState('');
  const [answerText, setAnswerText] = useState('');
  const [groups, setGroups] = useState('');
  const [keywords, setKeywords] = useState('');
  const [runsText, setRunsText] = useState('');
  const [intervalText, setIntervalText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Derived quantity: for comment/usernames types the API charges per line.
  const derivedLines = config.showComments
    ? nonEmptyLines(comments).length
    : config.showUsernames
      ? nonEmptyLines(usernames).length
      : 0;
  const quantity = config.quantityMode === 'derived'
    ? derivedLines
    : config.quantityMode === 'locked'
      ? service.min
      : Math.max(0, Math.floor(Number(quantityText) || 0));
  const runs = config.showDripfeed && runsText.trim() !== ''
    ? Math.max(0, Math.floor(Number(runsText) || 0))
    : 1;
  const charge = Math.round(((service.rate * quantity * runs) / 1000) * 100) / 100;

  function validate(): string | null {
    if (config.showComments && derivedLines === 0) return 'Add at least one comment (one per line).';
    if (config.showUsernames && derivedLines === 0) return 'Add at least one username (one per line).';
    if (config.showDonorUsername && !donorUsername.trim()) return 'Add the donor username.';
    if (config.showHashtag && !hashtag.trim()) return 'Add the hashtag.';
    if (config.showAnswer) {
      const answer = Math.floor(Number(answerText));
      if (!Number.isFinite(answer) || answer < 1) return 'Choose a poll answer number.';
    }
    if (config.showGroups && nonEmptyLines(groups).length === 0) return 'Add at least one group (one per line).';
    if (config.showDripfeed) {
      if (runsText.trim() !== '') {
        const r = Math.floor(Number(runsText));
        if (!Number.isFinite(r) || r < 1) return 'Runs must be at least 1.';
      }
      if (intervalText.trim() !== '') {
        const iv = Math.floor(Number(intervalText));
        if (!Number.isFinite(iv) || iv < 1) return 'Interval must be at least 1 minute.';
      }
    }
    if (quantity < service.min || quantity > service.max) {
      return config.quantityMode === 'derived'
        ? `Add between ${formatNumber(service.min)} and ${formatNumber(service.max)} lines.`
        : `Quantity must be between ${formatNumber(service.min)} and ${formatNumber(service.max)}.`;
    }
    return null;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const extras: Record<string, string> = {};
      if (config.showComments) extras.comments = nonEmptyLines(comments).join('\n');
      if (config.showUsernames) extras.usernames = nonEmptyLines(usernames).join('\n');
      if (config.showDonorUsername) extras.username = donorUsername.trim();
      if (config.showHashtag) extras.hashtag = hashtag.trim();
      if (config.showAnswer) extras.answer_number = String(Math.floor(Number(answerText)));
      if (config.showGroups) extras.groups = nonEmptyLines(groups).join('\n');
      if (config.showKeywords && keywords.trim()) extras.keywords = keywords.trim();
      if (config.showDripfeed) {
        if (runsText.trim() !== '') extras.runs = String(Math.floor(Number(runsText)));
        if (intervalText.trim() !== '') extras.interval = String(Math.floor(Number(intervalText)));
      }
      const result = await createOrder(service.id, link, quantity, extras);
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
        {service.description && <p className="description-box">{service.description}</p>}
        <form onSubmit={submit} className="form-stack">
          <label>{field.label}<input required value={link} onChange={(e) => setLink(e.target.value)} placeholder={field.placeholder} /></label>
          {config.showComments && (
            <label>Comments
              <textarea required value={comments} onChange={(e) => setComments(e.target.value)} placeholder="One comment per line" rows={5} />
              <span className="field-hint">{derivedLines} line{derivedLines === 1 ? '' : 's'} — quantity follows your lines.</span>
            </label>
          )}
          {config.showUsernames && (
            <label>Usernames
              <textarea required value={usernames} onChange={(e) => setUsernames(e.target.value)} placeholder="One username per line" rows={5} />
              <span className="field-hint">{derivedLines} line{derivedLines === 1 ? '' : 's'} — quantity follows your lines.</span>
            </label>
          )}
          {config.showDonorUsername && (
            <label>Donor username<input required value={donorUsername} onChange={(e) => setDonorUsername(e.target.value)} placeholder="username" /></label>
          )}
          {config.showHashtag && (
            <label>Hashtag<input required value={hashtag} onChange={(e) => setHashtag(e.target.value)} placeholder="#example" /></label>
          )}
          {config.showAnswer && (
            <label>Poll answer number<input required type="number" inputMode="numeric" min={1} value={answerText} onChange={(e) => setAnswerText(e.target.value)} placeholder="1" /></label>
          )}
          {config.showGroups && (
            <label>Groups<textarea required value={groups} onChange={(e) => setGroups(e.target.value)} placeholder="One group per line" rows={5} /></label>
          )}
          {config.showKeywords && (
            <label>Keywords (optional)<textarea value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="One keyword per line" rows={3} /></label>
          )}
          {config.quantityMode === 'editable' && (
            <label>Quantity<input required type="number" inputMode="numeric" min={service.min} max={service.max} value={quantityText} onChange={(e) => setQuantityText(e.target.value)} placeholder={String(service.min)} /></label>
          )}
          {config.quantityMode === 'derived' && (
            <p className="muted">Quantity: {derivedLines} (from your lines above)</p>
          )}
          {config.quantityMode === 'locked' && (
            <p className="muted">Package size: {formatNumber(service.min)} (fixed)</p>
          )}
          {config.showDripfeed && (
            <>
              <label>Runs (optional)<input type="number" inputMode="numeric" min={1} value={runsText} onChange={(e) => setRunsText(e.target.value)} placeholder="1" /></label>
              <label>Interval in minutes (optional)<input type="number" inputMode="numeric" min={1} value={intervalText} onChange={(e) => setIntervalText(e.target.value)} placeholder="30" /></label>
              <p className="muted">Total volume = quantity × runs.</p>
            </>
          )}
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
