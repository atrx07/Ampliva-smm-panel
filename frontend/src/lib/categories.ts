// Customer-facing category labels. The provider's raw category names leak
// internal branding and typos onto the storefront ("Cidstore" is CID's own
// name for its misc bucket; "Market crash" is provider promo noise), so the
// store displays cleaned labels instead. Filtering and search use these
// display labels too, so two raw buckets can share one label ("Mixed").
// The raw names are untouched in the database and in the admin panel.
const CATEGORY_LABELS: Record<string, string> = {
  Cidstore: 'Mixed',
  '🚀Market crash service🤯': 'Mixed',
  'Instgram Post/Reel share': 'Instagram Shares',
};

export function displayCategory(raw: string): string {
  return CATEGORY_LABELS[raw] ?? raw.replace(/\s+/g, ' ').trim();
}
