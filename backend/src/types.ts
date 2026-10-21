export interface Env {
  DB?: D1Database;
  CID_API_KEY?: string;
  CID_API_URL?: string;
  CID_CURRENCY?: string;
  DEFAULT_MARKUP_PERCENT?: string;
  /** Email that always gets the admin role (also: the first registered user becomes admin). */
  ADMIN_EMAIL?: string;
  /** Public UPI ID customers send manual top-ups to. Shown on the wallet page. */
  PUBLIC_UPI_ID?: string;
  /** Optional Discord webhook URL for owner notifications (secret; dashboard-only). */
  ADMIN_DISCORD_WEBHOOK?: string;
  SESSION_TTL_DAYS?: string;
}

export type Platform = 'instagram' | 'youtube' | 'tiktok' | 'facebook' | 'telegram' | 'x' | 'other';

export interface PublicService {
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

export interface RawCidService {
  service: string | number;
  name: string;
  type?: string;
  rate: string | number;
  min: string | number;
  max: string | number;
  category?: string;
  description?: string;
  refill?: boolean | string;
  cancel?: boolean | string;
  dripfeed?: boolean | string;
}

export interface ServiceRow {
  id: string;
  provider_id: number;
  provider_name: string;
  display_name: string | null;
  category: string;
  platform: Platform;
  provider_rate: number;
  retail_rate: number;
  markup_override: number | null;
  min: number;
  max: number;
  refill: number;
  cancel: number;
  description: string | null;
  is_active: number;
  provider_active: number;
  first_seen_at: string;
  last_synced_at: string;
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  role: 'user' | 'admin';
  created_at: string;
}

export interface OrderRow {
  id: string;
  user_id: string;
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

export interface CidOrderStatus {
  charge?: string;
  start_count?: string;
  status?: string;
  remains?: string;
  currency?: string;
  error?: string;
}
