export interface Env {
  CID_API_KEY?: string;
  CID_API_URL?: string;
  CID_CURRENCY?: string;
  DEFAULT_MARKUP_PERCENT?: string;
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
