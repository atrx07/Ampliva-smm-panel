import type {
  AdminService,
  AdminStats,
  AuthResponse,
  Order,
  PaymentRequest,
  PublicConfig,
  ServicesResponse,
  WalletResponse,
} from './types';

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8787').replace(/\/$/, '');
const TOKEN_KEY = 'ampliva_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Ampliva API returned ${response.status}`);
  }
  return data;
}

export function getServices(): Promise<ServicesResponse> {
  return api<ServicesResponse>('/api/services');
}

export function getConfig(): Promise<PublicConfig> {
  return api<PublicConfig>('/api/config');
}

export function register(email: string, password: string): Promise<AuthResponse> {
  return api<AuthResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return api<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function logout(): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
}

export function getMe(): Promise<{ user: AuthResponse['user']; balance: number; currency: string }> {
  return api('/api/auth/me');
}

export function getWallet(): Promise<WalletResponse> {
  return api<WalletResponse>('/api/wallet');
}

export function createTopup(amount: number, txnRef: string): Promise<{ id: string; status: string }> {
  return api('/api/wallet/topups', { method: 'POST', body: JSON.stringify({ amount, txnRef }) });
}

export function createOrder(serviceId: string, link: string, quantity: number): Promise<{ orderId: string; charge: number; balance: number; status: string }> {
  return api('/api/orders', { method: 'POST', body: JSON.stringify({ serviceId, link, quantity }) });
}

export function getOrders(): Promise<{ orders: Order[] }> {
  return api('/api/orders');
}

export function refreshOrder(id: string): Promise<{ order: Order }> {
  return api(`/api/orders/${id}/refresh`, { method: 'POST' });
}

export function refillOrder(id: string): Promise<{ ok: boolean; refillId: string }> {
  return api(`/api/orders/${id}/refill`, { method: 'POST' });
}

export function cancelOrder(id: string): Promise<{ ok: boolean; order: Order }> {
  return api(`/api/orders/${id}/cancel`, { method: 'POST' });
}

// --- admin ---

export function adminSync(): Promise<{ ok: boolean; serviceCount: number; syncedAt: string }> {
  return api('/api/admin/sync', { method: 'POST' });
}

export function adminStats(): Promise<AdminStats> {
  return api('/api/admin/stats');
}

export function adminServices(): Promise<{ services: AdminService[] }> {
  return api('/api/admin/services');
}

export function adminUpdateService(id: string, patch: { displayName?: string | null; markupPercent?: number | null; isActive?: boolean }): Promise<{ service: AdminService }> {
  return api(`/api/admin/services/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function adminTopups(): Promise<{ topups: PaymentRequest[] }> {
  return api('/api/admin/topups');
}

export function adminApproveTopup(id: string): Promise<{ ok: boolean }> {
  return api(`/api/admin/topups/${id}/approve`, { method: 'POST' });
}

export function adminRejectTopup(id: string): Promise<{ ok: boolean }> {
  return api(`/api/admin/topups/${id}/reject`, { method: 'POST' });
}

export function adminOrders(): Promise<{ orders: Order[] }> {
  return api('/api/admin/orders');
}
