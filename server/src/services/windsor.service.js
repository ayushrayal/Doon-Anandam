import { env, validateWindsorEnv } from '../config/env.js';

export const WINDSOR_SUPPORTED_FIELDS = [
  'date',
  'account_id',
  'account_name',
  'id',
  'created_time',
  'full_name',
  'email',
  'phone_number',
  'form_id',
  'form_name',
  'campaign',
  'campaign_id',
  'adset_name',
  'ad_name',
  'datasource',
];

/**
 * Constructs the Windsor.ai connector URL using URL and URLSearchParams.
 * Uses `select_accounts` and explicit fields list; never uses malformed `filter`.
 */
export function buildWindsorRequestUrl({
  baseUrl = env.WINDSOR_API_BASE_URL,
  endpoint = '/facebook_leads',
  datePreset = env.WINDSOR_DATE_PRESET,
  accountId = env.WINDSOR_ACCOUNT_ID,
  apiKey = env.WINDSOR_API_KEY,
  fields = WINDSOR_SUPPORTED_FIELDS,
} = {}) {
  const url = new URL(endpoint, baseUrl);
  url.searchParams.set('date_preset', datePreset);
  url.searchParams.set('fields', Array.isArray(fields) ? fields.join(',') : fields);
  url.searchParams.set('select_accounts', accountId);
  url.searchParams.set('api_key', apiKey);
  return url;
}

/**
 * Returns a sanitized URL string with the API key redacted for secure logging.
 */
export function getSanitizedUrl(url) {
  try {
    const parsed = new URL(url.toString());
    if (parsed.searchParams.has('api_key')) {
      parsed.searchParams.set('api_key', 'REDACTED');
    }
    return parsed.toString();
  } catch {
    return '[INVALID_URL]';
  }
}

/**
 * Validates and transforms a single raw record from Windsor.ai.
 * Rejects records from unexpected account IDs or missing external IDs.
 */
export function mapAndValidateLeadRecord(rawRecord, configuredAccountId) {
  if (!rawRecord || typeof rawRecord !== 'object') {
    return { valid: false, reason: 'Record payload is not an object.' };
  }

  // Strict account ID verification against configured account ID
  const rawAccountId = String(rawRecord.account_id ?? '').trim();
  const targetAccountId = String(configuredAccountId ?? '').trim();

  if (!rawAccountId || rawAccountId !== targetAccountId) {
    return {
      valid: false,
      reason: 'Record account_id does not match configured Windsor account.',
      skippedDueToAccountMismatch: true,
    };
  }

  // External lead ID must be present
  const externalLeadId = String(rawRecord.id ?? '').trim();
  if (!externalLeadId) {
    return {
      valid: false,
      reason: 'Record is missing upstream lead ID.',
    };
  }

  // Email is optional and nullable
  let email = null;
  if (
    rawRecord.email &&
    typeof rawRecord.email === 'string' &&
    rawRecord.email.trim() !== ''
  ) {
    email = rawRecord.email.trim().toLowerCase();
  }

  // Phone number is optional and nullable
  let phoneNumber = null;
  if (
    rawRecord.phone_number !== undefined &&
    rawRecord.phone_number !== null &&
    String(rawRecord.phone_number).trim() !== ''
  ) {
    phoneNumber = String(rawRecord.phone_number).trim();
  }

  // Lead creation timestamp
  let leadCreatedAt = null;
  const rawDate = rawRecord.created_time || rawRecord.date;
  if (rawDate) {
    const parsedDate = new Date(rawDate);
    if (!isNaN(parsedDate.getTime())) {
      leadCreatedAt = parsedDate;
    }
  }

  return {
    valid: true,
    lead: {
      externalLeadId,
      source: 'facebook_leads',
      accountId: targetAccountId,
      accountName: String(rawRecord.account_name ?? '').trim(),
      fullName: String(rawRecord.full_name ?? '').trim(),
      email,
      phoneNumber,
      formId: String(rawRecord.form_id ?? '').trim(),
      formName: String(rawRecord.form_name ?? '').trim(),
      campaignName: String(rawRecord.campaign ?? '').trim(),
      campaignId: String(rawRecord.campaign_id ?? '').trim(),
      adsetName: String(rawRecord.adset_name ?? '').trim(),
      adName: String(rawRecord.ad_name ?? '').trim(),
      leadCreatedAt,
    },
  };
}

/**
 * Fetches Facebook Lead Ads records from Windsor.ai.
 * Can accept a custom fetchFn for testing and mocking.
 */
export async function fetchFacebookLeads({
  overrideEnv = null,
  fetchFn = fetch,
} = {}) {
  const currentEnv = overrideEnv || env;
  validateWindsorEnv(currentEnv);

  const requestUrl = buildWindsorRequestUrl({
    baseUrl: currentEnv.WINDSOR_API_BASE_URL,
    endpoint: '/facebook_leads',
    datePreset: currentEnv.WINDSOR_DATE_PRESET,
    accountId: currentEnv.WINDSOR_ACCOUNT_ID,
    apiKey: currentEnv.WINDSOR_API_KEY,
  });

  const timeoutMs = currentEnv.WINDSOR_REQUEST_TIMEOUT_MS || 15000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetchFn(requestUrl.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError' || controller.signal.aborted) {
      const error = new Error(`Windsor request timed out after ${timeoutMs}ms.`);
      error.status = 504;
      error.code = 'UPSTREAM_TIMEOUT';
      throw error;
    }
    const error = new Error('Failed to connect to Windsor upstream connector.');
    error.status = 502;
    error.code = 'UPSTREAM_NETWORK_ERROR';
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const error = new Error(`Windsor connector responded with HTTP ${response.status}.`);
    error.status = response.status >= 500 ? 502 : 400;
    error.code = 'UPSTREAM_HTTP_ERROR';
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new Error('Windsor returned an invalid non-JSON payload.');
    error.status = 502;
    error.code = 'INVALID_UPSTREAM_JSON';
    throw error;
  }

  // Handle both { data: [...] } and direct array [...] formats
  let records = [];
  if (Array.isArray(payload)) {
    records = payload;
  } else if (payload && Array.isArray(payload.data)) {
    records = payload.data;
  } else if (payload && payload.error) {
    const error = new Error('Windsor connector returned an upstream error message.');
    error.status = 502;
    error.code = 'UPSTREAM_API_ERROR';
    throw error;
  } else {
    const error = new Error('Windsor payload did not contain a valid records array.');
    error.status = 502;
    error.code = 'INVALID_UPSTREAM_STRUCTURE';
    throw error;
  }

  return {
    rawRecords: records,
    accountId: currentEnv.WINDSOR_ACCOUNT_ID,
  };
}
