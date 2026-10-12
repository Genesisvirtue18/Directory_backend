import { z } from 'zod';

const secret = z.string().min(32).refine(value => !value.startsWith('replace-'), 'Replace the placeholder with a random secret');
const clientOrigin = z.url().refine(value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}, 'Use an HTTP(S) origin without a trailing slash or path');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\/\S+$/, 'A MongoDB connection URI is required'),
  JWT_ACCESS_SECRET: secret,
  JWT_REFRESH_SECRET: secret,
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  CLIENT_URL: clientOrigin,
  CLIENT_URL_2: clientOrigin.optional(),
  TRUST_PROXY: z.string().default(''),
  EMAIL_FROM: z.string().optional(),
  SMS_PROVIDER: z.string().default('development'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
}).refine(value => value.JWT_ACCESS_SECRET !== value.JWT_REFRESH_SECRET, {
  path: ['JWT_REFRESH_SECRET'], message: 'Access and refresh secrets must differ',
});

export function parseEnv(source = process.env) {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${result.error.issues.map(issue => `- ${issue.path.join('.')}: ${issue.message}`).join('\n')}`);
  }
  return Object.freeze(result.data);
}
