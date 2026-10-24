import type { Service } from '../types';

// Per-service order-form shape, driven by the provider's service `type`
// (audit 2026-10-25). Mirrors the backend map in catalog.ts — keep both
// in sync. Unknown types fall back to the default link + quantity form.
export type ServiceKind =
  | 'default'
  | 'package'
  | 'customComments'
  | 'mentionsCustomList'
  | 'mentionsHashtag'
  | 'mentionsUserFollowers'
  | 'poll'
  | 'invites'
  | 'seo';

export function normalizeServiceType(raw?: string | null): ServiceKind {
  const key = (raw ?? '').toLowerCase().replace(/[\s_\-]+/g, '');
  switch (key) {
    case '':
    case 'default':
      return 'default';
    case 'package':
      return 'package';
    case 'customcomments':
      return 'customComments';
    case 'mentionscustomlist':
    case 'mentions':
      return 'mentionsCustomList';
    case 'mentionshashtag':
      return 'mentionsHashtag';
    case 'mentionsuserfollowers':
      return 'mentionsUserFollowers';
    case 'poll':
      return 'poll';
    case 'invitesfromgroups':
    case 'invites':
      return 'invites';
    case 'seo':
    case 'webtraffic':
    case 'traffic':
      return 'seo';
    default:
      return 'default';
  }
}

export type QuantityMode = 'editable' | 'derived' | 'locked';

export interface OrderFormConfig {
  kind: ServiceKind;
  showComments: boolean;
  showUsernames: boolean;
  showDonorUsername: boolean;
  showHashtag: boolean;
  showAnswer: boolean;
  showGroups: boolean;
  showKeywords: boolean;
  showDripfeed: boolean;
  /** derived: quantity = lines of comments/usernames; locked: package
   *  size (min); editable: the usual quantity box. */
  quantityMode: QuantityMode;
}

export function orderFormConfig(service: Service): OrderFormConfig {
  const kind = normalizeServiceType(service.type);
  return {
    kind,
    showComments: kind === 'customComments',
    showUsernames: kind === 'mentionsCustomList',
    showDonorUsername: kind === 'mentionsUserFollowers',
    showHashtag: kind === 'mentionsHashtag',
    showAnswer: kind === 'poll',
    showGroups: kind === 'invites',
    showKeywords: kind === 'seo',
    showDripfeed: service.dripfeed === true,
    quantityMode:
      kind === 'customComments' || kind === 'mentionsCustomList'
        ? 'derived'
        : kind === 'package'
          ? 'locked'
          : 'editable',
  };
}

const LINK_PLACEHOLDERS: Record<string, string> = {
  instagram: 'https://instagram.com/…',
  youtube: 'https://youtube.com/watch?v=…',
  tiktok: 'https://tiktok.com/@…/video/…',
  facebook: 'https://facebook.com/…',
  telegram: 'https://t.me/…',
  x: 'https://x.com/…',
  other: 'https://…',
};

// The link field does not always want a link. Username-only services say
// so in their description ("Put Username", "username only"); comment-like
// services want the specific comment's link, not the post link. Everything
// else gets the platform's example URL instead of a hardcoded instagram one.
export function linkField(service: Service): { label: string; placeholder: string } {
  const description = service.description ?? '';
  if (/put username|username only/i.test(description)) {
    return { label: 'Username', placeholder: 'username (no link)' };
  }
  if (/comment like/i.test(service.name)) {
    return { label: 'Link to the comment', placeholder: 'Your comment’s link, not the post link' };
  }
  return { label: 'Link to promote', placeholder: LINK_PLACEHOLDERS[service.platform] ?? 'https://…' };
}

export function nonEmptyLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
