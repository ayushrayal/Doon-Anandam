import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Schema definition for environment configuration
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLIENT_URL: z.string().trim().default('http://localhost:5173'),
  MONGODB_URI: z.string().trim().optional(),
  JWT_SECRET: z.string().trim().optional(),
  JWT_EXPIRES_IN: z.string().trim().default('7d'),
  USE_CUSTOM_DNS: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (typeof val === 'boolean') return val;
      return val?.toLowerCase() === 'true';
    })
    .default(false),

  // Windsor.ai Connector Configuration (Backend Only)
  WINDSOR_API_KEY: z.string().trim().optional(),
  WINDSOR_ACCOUNT_ID: z.string().trim().optional(),
  WINDSOR_API_BASE_URL: z.string().trim().url().default('https://connectors.windsor.ai'),
  WINDSOR_DATE_PRESET: z.string().trim().default('last_7d'),
  WINDSOR_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[Config Error] Invalid environment variables:');
  console.error(parsed.error.format());
  process.exit(1);
}

// In production, enforce MONGODB_URI
if (parsed.data.NODE_ENV === 'production' && !parsed.data.MONGODB_URI) {
  console.error('[Config Error] Fatal: MONGODB_URI is required when running in production mode.');
  process.exit(1);
}

// In production, never allow custom public DNS overrides
const useCustomDns = parsed.data.NODE_ENV !== 'production' && Boolean(parsed.data.USE_CUSTOM_DNS);
if (parsed.data.NODE_ENV === 'production' && parsed.data.USE_CUSTOM_DNS) {
  console.warn('[Config] USE_CUSTOM_DNS is ignored in production mode to maintain infrastructure predictability.');
}

const isWindsorConfigured = Boolean(
  parsed.data.WINDSOR_API_KEY &&
    parsed.data.WINDSOR_API_KEY.trim() !== '' &&
    parsed.data.WINDSOR_API_KEY !== 'replace_with_your_windsor_api_key' &&
    parsed.data.WINDSOR_ACCOUNT_ID &&
    parsed.data.WINDSOR_ACCOUNT_ID.trim() !== '' &&
    parsed.data.WINDSOR_ACCOUNT_ID !== 'replace_with_your_confirmed_account_id'
);

export const env = {
  ...parsed.data,
  USE_CUSTOM_DNS: useCustomDns,
  isDbConfigured: Boolean(parsed.data.MONGODB_URI && parsed.data.MONGODB_URI.length > 0),
  isWindsorConfigured,
};

/**
 * Validates JWT configuration when authentication services initialize.
 * Enforces minimum length of 32 characters for security.
 */
export function validateAuthEnv() {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    throw new Error(
      'Authentication configuration error: JWT_SECRET is required and must be at least 32 characters long.'
    );
  }
}

/**
 * Validates Windsor.ai configuration when manual lead synchronization is invoked.
 * Enforces non-empty API key and confirmed Account ID without leaking secrets.
 */
export function validateWindsorEnv(overrideEnv = null) {
  const currentEnv = overrideEnv || env;
  const apiKey = currentEnv.WINDSOR_API_KEY;
  const accountId = currentEnv.WINDSOR_ACCOUNT_ID;

  if (
    !apiKey ||
    typeof apiKey !== 'string' ||
    apiKey.trim() === '' ||
    apiKey === 'replace_with_your_windsor_api_key'
  ) {
    const error = new Error('Windsor configuration error: WINDSOR_API_KEY is not configured.');
    error.status = 503;
    error.code = 'WINDSOR_NOT_CONFIGURED';
    throw error;
  }

  if (
    !accountId ||
    typeof accountId !== 'string' ||
    accountId.trim() === '' ||
    accountId === 'replace_with_your_confirmed_account_id'
  ) {
    const error = new Error(
      'Windsor configuration error: WINDSOR_ACCOUNT_ID must be a confirmed non-empty Facebook Lead Ads account ID.'
    );
    error.status = 503;
    error.code = 'WINDSOR_ACCOUNT_NOT_CONFIRMED';
    throw error;
  }
}
