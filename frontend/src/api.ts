import type { ServicesResponse } from './types';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8787').replace(/\/$/, '');

export async function getServices(): Promise<ServicesResponse> {
  const response = await fetch(`${API_BASE}/api/services`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Ampliva API returned ${response.status}`);
  }

  return response.json() as Promise<ServicesResponse>;
}
