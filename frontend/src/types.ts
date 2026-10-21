export type Platform = 'instagram' | 'youtube' | 'tiktok' | 'facebook' | 'telegram' | 'x' | 'other';

export interface Service {
  id: string;
  name: string;
  category: string;
  platform: Platform;
  rate: number;
  min: number;
  max: number;
  refill: boolean;
  cancel: boolean;
  description?: string;
}

export interface ServicesResponse {
  services: Service[];
  source: 'live' | 'preview' | 'fallback';
  currency: string;
  updatedAt: string;
  warning?: string;
}

export interface PublicConfig {
  currency: string;
  upiId: string | null;
  manualTopupsEnabled: boolean;
  orderingEnabled: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface WalletTransaction {
  id: string;
  type: 'topup' | 'order_debit' | 'refund' | 'admin_adjust';
  amount: number;
  balance_after: number;
  note: string | null;
  created_at: string;
}

export interface PaymentRequest {
  id: string;
  user_id: string;
  user_email?: string;
  amount: number;
  method: string;
  txn_ref: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  decided_at: string | null;
}

export interface Order {
  id: string;
  user_id: string;
  user_email?: string;
  service_id: string;
  service_name: string;
  provider_order_id: string | null;
  link: string;
  quantity: number;
  charge: number;
  provider_cost: number;
  status: string;
  start_count: number | null;
  remains: number | null;
  refund_amount: number;
  created_at: string;
  updated_at: string;
}

export interface WalletResponse {
  balance: number;
  currency: string;
  transactions: WalletTransaction[];
  topups: PaymentRequest[];
}

export interface AdminService extends Service {
  provider_id: number;
  provider_name: string;
  display_name: string | null;
  provider_rate: number;
  retail_rate: number;
  markup_override: number | null;
  is_active: number;
  provider_active: number;
  last_synced_at: string;
}

export interface AdminStats {
  users: number;
  activeServices: number;
  orders: number;
  revenue: number;
  providerCost: number;
  refunds: number;
  grossMargin: number;
  pendingTopups: number;
  providerBalance: number | null;
  currency: string;
}
