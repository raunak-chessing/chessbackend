import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(4001),

  DATABASE_URL: Joi.string().uri().required(),
  DATABASE_REPLICA_URL: Joi.string().uri().optional().allow(''),
  DB_POOL_MAX: Joi.number().default(20),
  DB_POOL_IDLE_TIMEOUT_MS: Joi.number().default(30000),
  DB_POOL_CONNECTION_TIMEOUT_MS: Joi.number().default(5000),
  DB_STATEMENT_TIMEOUT_MS: Joi.number().default(15000),

  REDIS_URL: Joi.string().default('redis://localhost:6379'),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  QUEUE_REDIS_DB: Joi.number().default(1),

  FRONTEND_URL: Joi.string().uri().default('http://localhost:3000'),
  ADMIN_EMAILS: Joi.string().default('admin@chessing.local'),

  BETTER_AUTH_URL: Joi.string().uri().default('http://localhost:4001'),
  BETTER_AUTH_SECRET: Joi.string().optional(),
  GOOGLE_CLIENT_ID: Joi.string().optional().allow(''),
  GOOGLE_CLIENT_SECRET: Joi.string().optional().allow(''),
  GITHUB_CLIENT_ID: Joi.string().optional().allow(''),
  GITHUB_CLIENT_SECRET: Joi.string().optional().allow(''),

  SENTRY_DSN: Joi.string().optional().allow(''),

  STRIPE_SECRET_KEY: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  STRIPE_WEBHOOK_SECRET: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  STRIPE_PREMIUM_PRICE_ID: Joi.string().optional().allow(''),

  SMTP_HOST: Joi.string().default('smtp.ethereal.email'),
  SMTP_PORT: Joi.number().default(587),
  SMTP_USER: Joi.string().optional().allow(''),
  SMTP_PASS: Joi.string().optional().allow(''),
  SMTP_FROM: Joi.string().optional(),

  GEMINI_API_KEY: Joi.string().optional().allow(''),
}).unknown(true);
