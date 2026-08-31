import type { RawCidService } from '../types';

export class CIDClient {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
  ) {}

  async services(): Promise<RawCidService[]> {
    const body = new URLSearchParams({
      key: this.apiKey,
      action: 'services',
    });

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

    if (!Array.isArray(payload)) {
      const message = typeof payload === 'object' && payload && 'error' in payload
        ? String((payload as { error?: unknown }).error)
        : 'Unexpected CID services response';
      throw new Error(message);
    }

    return payload as RawCidService[];
  }
}
