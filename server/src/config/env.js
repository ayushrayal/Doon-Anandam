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
  JWT_EXPIRES_IN: z.string().trim().optional(),
  USE_CUSTOM_DNS: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (typeof val === 'boolean') return val;
      return val?.toLowerCase() === 'true';
    })
    .default(false),
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

export const env = {
  ...parsed.data,
  USE_CUSTOM_DNS: useCustomDns,
  isDbConfigured: Boolean(parsed.data.MONGODB_URI && parsed.data.MONGODB_URI.length > 0),
};
