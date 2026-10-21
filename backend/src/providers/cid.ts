import type { CidOrderStatus, RawCidService } from '../types';

/**
 * CID Growth Media adapter — standard SMM API v2 shape.
 * All calls are server-side only; the API key never reaches the browser.
 */
export class CIDClient {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
  ) {}

  private async request(params: Record<string, string>): Promise<unknown> {
    const body = new URLSearchParams({ key: this.apiKey, ...params });
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`CID returned non-JSON data (${response.status})`);
    }
    if (!response.ok) {
      throw new Error(`CID returned HTTP ${response.status}`);
    }
    return payload;
  }

  private static errorOf(payload: unknown): string | null {
    if (payload && typeof payload === 'object' && 'error' in payload) {
      return String((payload as { error?: unknown }).error ?? 'Unknown provider error');
    }
    return null;
  }

  async services(): Promise<RawCidService[]> {
    const payload = await this.request({ action: 'services' });
    if (!Array.isArray(payload)) {
      throw new Error(CIDClient.errorOf(payload) ?? 'Unexpected CID services response');
    }
    return payload as RawCidService[];
  }

  async balance(): Promise<{ balance: number; currency: string }> {
    const payload = await this.request({ action: 'balance' }) as { balance?: string | number; currency?: string; error?: string };
    const err = CIDClient.errorOf(payload);
    if (err) throw new Error(err);
    return { balance: Number(payload.balance ?? 0), currency: String(payload.currency ?? '') };
  }

  /** Creates an order at the provider. Returns the provider order id. */
  async addOrder(serviceId: number, link: string, quantity: number): Promise<string> {
    const payload = await this.request({
      action: 'add',
      service: String(serviceId),
      link,
      quantity: String(quantity),
    }) as { order?: string | number; error?: string };
    const err = CIDClient.errorOf(payload);
    if (err) throw new Error(err);
    if (payload.order === undefined || payload.order === null || payload.order === '') {
      throw new Error('CID did not return an order id');
    }
    return String(payload.order);
  }

  async status(orderId: string): Promise<CidOrderStatus> {
    const payload = await this.request({ action: 'status', order: orderId }) as CidOrderStatus;
    if (payload.error) throw new Error(String(payload.error));
    return payload;
  }

  async refill(orderId: string): Promise<string> {
    const payload = await this.request({ action: 'refill', order: orderId }) as { refill?: string | number; error?: string };
    const err = CIDClient.errorOf(payload);
    if (err) throw new Error(err);
    return String(payload.refill ?? '');
  }

  async cancel(orderId: string): Promise<void> {
    const payload = await this.request({ action: 'cancel', order: orderId });
    const err = CIDClient.errorOf(payload);
    if (err) throw new Error(err);
  }
}

export function cidClientFromEnv(env: { CID_API_URL?: string; CID_API_KEY?: string }): CIDClient | null {
  if (!env.CID_API_KEY) return null;
  return new CIDClient(env.CID_API_URL || 'https://cidgrowthmedia.com/api/v2', env.CID_API_KEY);
}
