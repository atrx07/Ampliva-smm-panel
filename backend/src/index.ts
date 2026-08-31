import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { normalizeServices, previewServices } from './catalog';
import { CIDClient } from './providers/cid';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

// Milestone 1 exposes read-only catalogue routes only. Restrict CORS before
// checkout/auth write routes are introduced.
app.use('/api/*', cors({ origin: '*' }));

app.get('/api/health', (c) => {
  return c.json({
    ok: true,
    service: 'ampliva-api',
    providerConfigured: Boolean(c.env.CID_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/services', async (c) => {
  const currency = c.env.CID_CURRENCY || 'INR';
  const markup = Number(c.env.DEFAULT_MARKUP_PERCENT || '35');
  const updatedAt = new Date().toISOString();

  if (!c.env.CID_API_KEY) {
    return c.json({
      services: previewServices,
      source: 'preview' as const,
      currency,
      updatedAt,
      warning: 'CID_API_KEY is not configured yet, so Ampliva is showing its safe preview catalogue.',
    });
  }

  try {
    const client = new CIDClient(
      c.env.CID_API_URL || 'https://cidgrowthmedia.com/api/v2',
      c.env.CID_API_KEY,
    );
    const rawServices = await client.services();
    const services = normalizeServices(rawServices, Number.isFinite(markup) ? markup : 35);

    return c.json({
      services,
      source: 'live' as const,
      currency,
      updatedAt,
    });
  } catch (error) {
    console.error('CID catalogue sync failed:', error instanceof Error ? error.message : 'unknown error');
    return c.json({
      services: previewServices,
      source: 'fallback' as const,
      currency,
      updatedAt,
      warning: 'The live provider catalogue is temporarily unavailable. Preview services are shown instead.',
    });
  }
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((error, c) => {
  console.error('Unhandled Ampliva API error:', error.message);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
