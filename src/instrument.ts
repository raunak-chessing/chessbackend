import * as dotenv from 'dotenv';
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

// This file is imported first in main.ts, before AppModule (and therefore
// ConfigModule) ever loads .env into process.env — so SENTRY_DSN has to be
// read here directly, or Sentry always falls back to the dummy DSN below.
// No-ops safely in production, where there's no .env file and real env vars
// come from the container instead.
dotenv.config();

Sentry.init({
  dsn: process.env.SENTRY_DSN || "https://dummy@o0.ingest.sentry.io/0",
  integrations: [
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});
