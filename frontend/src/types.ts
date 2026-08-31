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
