/**
 * Formats a raw acquisition channel or source identifier for user-facing CRM display.
 * Maps Meta / Facebook Lead Ads sources explicitly to 'Meta' (or 'Facebook Lead Ads')
 * while preserving genuine channels and falling back safely for unknown/unspecified sources.
 *
 * Windsor.ai is recognized as the sync/integration provider, not the acquisition source.
 */
export function formatSourceLabel(source) {
  if (!source) return 'Unknown';
  const s = String(source).trim().toLowerCase();

  if (
    s === 'facebook_leads' ||
    s === 'meta' ||
    s === 'facebook' ||
    s === 'facebook_ads' ||
    s === 'meta_leads' ||
    s === 'meta_lead_ads' ||
    s.startsWith('facebook') ||
    s.startsWith('meta')
  ) {
    return 'Meta';
  }

  if (s === 'google_ads' || s === 'google' || s.startsWith('google')) {
    return 'Google Ads';
  }

  if (s === 'linkedin_ads' || s === 'linkedin' || s.startsWith('linkedin')) {
    return 'LinkedIn Ads';
  }

  if (s === 'windsor' || s === 'windsor.ai') {
    // If incoming source was mistakenly tagged with the sync provider name, display Unknown
    return 'Unknown';
  }

  if (s === 'unknown' || s === 'unspecified') {
    return 'Unknown';
  }

  // General formatting for organic/direct/other channels
  return source
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
