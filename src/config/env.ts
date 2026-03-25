import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV:              z.enum(['development', 'production', 'test']).default('development'),
  PORT:                  z.string().default('5000'),
  MONGO_URI:             z.string().min(1, 'MONGO_URI is required'),
  JWT_ACCESS_SECRET:     z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_ACCESS_EXPIRY:     z.string().default('15m'),
  JWT_REFRESH_SECRET:    z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_REFRESH_EXPIRY:    z.string().default('7d'),
  VOTE_HASH_SECRET:      z.string().min(32, 'VOTE_HASH_SECRET must be at least 32 chars'),
  EMAIL_API_KEY:         z.string().min(1, 'EMAIL_API_KEY is required'),
  EMAIL_FROM_ADDRESS:    z.string().email('EMAIL_FROM_ADDRESS must be a valid email'),
  FRONTEND_ORIGIN:       z.string().min(1, 'FRONTEND_ORIGIN is required'),
  SUPER_ADMIN_EMAIL:     z.string().email('SUPER_ADMIN_EMAIL must be a valid email'),
  SUPER_ADMIN_PASSWORD:  z.string().min(8, 'SUPER_ADMIN_PASSWORD must be at least 8 chars'),
  SUPER_ADMIN_FULL_NAME: z.string().min(1, 'SUPER_ADMIN_FULL_NAME is required'),
  CLOUDINARY_CLOUD_NAME: z.string().min(1, 'CLOUDINARY_CLOUD_NAME is required'),
  CLOUDINARY_API_KEY:    z.string().min(1, 'CLOUDINARY_API_KEY is required'),
  CLOUDINARY_API_SECRET: z.string().min(1, 'CLOUDINARY_API_SECRET is required'),

  // ─── AWS SES ──────────────────────────────────────────────
  AWS_REGION:            z.string().min(1, 'AWS_REGION is required'),
  AWS_ACCESS_KEY_ID:     z.string().min(1, 'AWS_ACCESS_KEY_ID is required'),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, 'AWS_SECRET_ACCESS_KEY is required'),

  // ─── Redis (BullMQ) ───────────────────────────────────────
  REDIS_HOST:            z.string().min(1, 'REDIS_HOST is required'),
  REDIS_PORT:            z.string().regex(/^\d+$/, 'REDIS_PORT must be a number'),
  REDIS_PASSWORD:        z.string().min(1, 'REDIS_PASSWORD is required'),

  // ─── Brevo ────────────────────────────────────────────────
  BREVO_API_KEY:         z.string().min(1, 'BREVO_API_KEY is required'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  parsed.error.errors.forEach((e) => {
    console.error(`  ${e.path.join('.')}: ${e.message}`);
  });
  process.exit(1);
}

export const env = parsed.data;