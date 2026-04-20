import http from 'http';
import pLimit from 'p-limit';
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
const RENDER_URL = 'https://uniballot-backend-2rtr.onrender.com';

// ── Vote concurrency limiter (exported for use in voting.service.ts) ──────────
// Caps simultaneous in-flight submitBallot calls at 40.
// Requests beyond this cap queue inside p-limit rather than inside MongoDB,
// which is cheaper and gives us back-pressure at the right layer.
export const voteLimit = pLimit(20);

let integrityWorker: Worker | null = null;
const pingIntervals: ReturnType<typeof setInterval>[] = [];

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[server] ${signal} received — shutting down gracefully`);
  for (const interval of pingIntervals) clearInterval(interval);
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

// ── Self-ping (keeps Render free tier warm) ───────────────────────────────────

async function ping(url: string): Promise<void> {
  console.log(`[${new Date().toISOString()}] self-ping attempting → ${url}`);
  try {
    const res = await fetch(url);
    console.log(`[${new Date().toISOString()}] self-ping OK (${url}) ${res.status}`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] self-ping FAILED (${url}):`, err);
  }
}

function startSelfPing(): void {
  const INTERNAL_URL = `http://127.0.0.1:${PORT}/health`;
  const EXTERNAL_URL = ((env as Record<string, string>)['SELF_PING_URL'] ?? RENDER_URL) + '/health';

  ping(INTERNAL_URL);
  ping(EXTERNAL_URL);

  pingIntervals.push(setInterval(() => ping(INTERNAL_URL), 3 * 60_000));
  pingIntervals.push(setInterval(() => ping(EXTERNAL_URL), 5 * 60_000));

  console.log(`[server] ✅ Self-ping started → internal: ${INTERNAL_URL} | external: ${EXTERNAL_URL}`);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

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

    // ── HTTP server with keep-alive tuned for Render's load balancer ─────────
    // Render's LB uses a 60s idle timeout. Setting keepAliveTimeout to 65s
    // ensures our server never closes a connection before Render does,
    // which prevents the "EOF" errors seen under spike load.
    const server = http.createServer(app);
    server.keepAliveTimeout = 65_000; // > Render LB 60s idle timeout
    server.headersTimeout   = 66_000; // must be > keepAliveTimeout

    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT} [${env.NODE_ENV}]`);
      startSelfPing();
    });

    // Surface server-level errors (e.g. EADDRINUSE) clearly
    server.on('error', (err) => {
      console.error('❌ HTTP server error:', err);
      process.exit(1);
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

bootstrap();