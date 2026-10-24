export function Landing({ serviceCount, orderingEnabled, onExplore }: {
  serviceCount: number;
  orderingEnabled: boolean;
  onExplore: () => void;
}) {
  return (
    <main id="top">
      <section className="hero">
        <div className="eyebrow">A cleaner way to manage promotional reach</div>
        <h1>Amplify your reach.<br /><span>Keep the process simple.</span></h1>
        <p className="hero-copy">
          Ampliva is a storefront for promotional services — followers, views, likes and
          members across Instagram, YouTube, Facebook, Telegram and more — with
          transparent limits and pricing before you order.
        </p>
        <div className="hero-actions">
          <button className="primary-button" type="button" onClick={onExplore}>Browse the store</button>
          <a className="ghost-button" href="#how">How it works</a>
          <span className="microcopy">{orderingEnabled ? 'Live ordering is on — top up your wallet and order in minutes.' : 'Live ordering switches on with the provider connection.'}</span>
        </div>
        <div className="hero-grid" aria-label="Ampliva highlights">
          <article><strong>{serviceCount || '—'}</strong><span>services in the store</span></article>
          <article><strong>₹0</strong><span>platform subscription</span></article>
          <article><strong>24/7</strong><span>store access</span></article>
        </div>
      </section>

      <section className="how-section" id="how">
        <div className="section-heading">
          <div>
            <div className="eyebrow">How Ampliva works</div>
            <h2>Three steps. No provider-side chaos.</h2>
          </div>
        </div>
        <div className="steps">
          <article><span>01</span><h3>Top up</h3><p>Add funds to your Ampliva wallet with UPI. Your balance is credited once the payment is verified. Instant card and UPI payments are coming soon.</p></article>
          <article><span>02</span><h3>Order</h3><p>Pick a service in the store, paste your link, choose a quantity. The exact price is shown before you confirm.</p></article>
          <article><span>03</span><h3>Track</h3><p>Follow delivery from your dashboard, with refill and cancel options where the service supports them.</p></article>
        </div>
      </section>

      <section className="how-section" id="faq">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Questions, answered honestly</div>
            <h2>Before you spend a rupee.</h2>
          </div>
        </div>
        <div className="faq-list">
          <article className="faq-item">
            <h3>What exactly am I buying?</h3>
            <p>Promotional reach — views, likes, followers or members delivered to a link you provide. Prices are per 1,000 units and shown upfront, along with minimum and maximum quantities.</p>
          </article>
          <article className="faq-item">
            <h3>How do top-ups work?</h3>
            <p>Pay by UPI from your dashboard, then submit the 12-digit UTR from your receipt. Your balance lands after a quick verification, usually within a few hours. Instant payments are coming soon.</p>
          </article>
          <article className="faq-item">
            <h3>How fast is delivery?</h3>
            <p>It varies by service — start times and speeds are described on each service in the store. Track progress from your dashboard once an order is placed.</p>
          </article>
          <article className="faq-item">
            <h3>What is a refill?</h3>
            <p>Some services refill numbers if they drop within the stated window. Where a service supports it, you can request a refill from your dashboard.</p>
          </article>
          <article className="faq-item">
            <h3>What happens if an order is cancelled?</h3>
            <p>If the provider cancels an order, the undelivered portion is refunded to your wallet automatically. You can also cancel eligible orders yourself from the dashboard.</p>
          </article>
          <article className="faq-item">
            <h3>Is this organic growth?</h3>
            <p>No — and it is never presented as such. Ampliva sells promotional reach, not guaranteed organic growth. Buy it for visibility, not as a substitute for content people want.</p>
          </article>
        </div>
        <div className="hero-actions">
          <button className="primary-button" type="button" onClick={onExplore}>Browse the store</button>
        </div>
      </section>
    </main>
  );
}
