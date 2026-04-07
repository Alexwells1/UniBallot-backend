import { env } from './config/env';
import { connectDatabase } from './config/database';
import { connectRedis } from './config/redis';
import app from './app';
import { startEmailWorkers, stopEmailWorkers } from './services/email/Emailworkers.bootstrap';
import { createIntegrityCheckWorker } from './jobs/integrityCheck.worker';
import type { Worker } from 'bullmq';
import fetch from 'node-fetch';
import { initRedisLimiters } from './middleware/rateLimiter';

const PORT = parseInt(env.PORT, 10);

let integrityWorker: Worker | null = null;

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[server] ${signal} received — shutting down gracefully`);
  try {
    await stopEmailWorkers();
    if (integrityWorker) await integrityWorker.close();
  } catch (err) {
    console.error('[server] Error during shutdown:', err);
  }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
  process.exit(1);
});

async function bootstrap(): Promise<void> {
  try {
    await connectRedis();
    console.log('[server] ✅ Redis connected');

    initRedisLimiters();

    await connectDatabase();
    console.log('[server] ✅ MongoDB connected');

    startEmailWorkers();
    integrityWorker = createIntegrityCheckWorker();
    console.log('[server] ✅ Workers started');

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT} [${env.NODE_ENV}]`);
      startSelfPing();
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Self-ping to prevent Render.com free-tier spin-down.
 * Only active in production and only when SELF_PING_URL is configured.
 * The external ping URL is read from the environment to avoid hardcoding
 * any deployment-specific hostname in source code.
 */
function startSelfPing(): void {
  if (env.NODE_ENV !== 'production') return;

  const INTERNAL_URL = `http://127.0.0.1:${PORT}/health`;
  const EXTERNAL_URL = (env as Record<string, string>)['SELF_PING_URL'];

  async function ping(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      console.log(`[${new Date().toISOString()}] self-ping (${url}) ${res.status}`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] self-ping (${url}) failed:`, err);
    }
  }

  ping(INTERNAL_URL);
  const internalInterval = setInterval(() => ping(INTERNAL_URL), 180_000);

  let externalInterval: ReturnType<typeof setInterval> | undefined;
  if (EXTERNAL_URL) {
    externalInterval = setInterval(() => ping(EXTERNAL_URL), 900_000);
  }

  process.once('SIGTERM', () => {
    clearInterval(internalInterval);
    if (externalInterval) clearInterval(externalInterval);
  });
  process.once('SIGINT', () => {
    clearInterval(internalInterval);
    if (externalInterval) clearInterval(externalInterval);
  });
}

bootstrap();
