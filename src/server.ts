import { env } from './config/env';
import { connectDatabase } from './config/database';
import app from './app';
import { startEmailWorkers, stopEmailWorkers } from './services/email/Emailworkers.bootstrap';
import fetch from 'node-fetch';

const PORT = parseInt(env.PORT, 10);

async function bootstrap(): Promise<void> {
  try {
    await connectDatabase();
    console.log('[server] ✅ MongoDB connected');

    startEmailWorkers();

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT} [${env.NODE_ENV}]`);

      let pinging = false;
      let internalPingInterval: ReturnType<typeof setInterval>;
      let externalPingInterval: ReturnType<typeof setInterval>;

      function startSelfPing() {
        if (pinging) return;
        pinging = true;
        console.log('✅ Self-ping started');

        const INTERNAL_URL = `http://127.0.0.1:${PORT}/health`;  // reliable internal ping
        const EXTERNAL_URL = `https://uniballot-backend.onrender.com/health`; // public URL ping

        async function ping(url: string) {
          try {
            const res = await fetch(url);
            console.log(`[${new Date().toISOString()}] Self-ping (${url}) status:`, res.status);
          } catch (err) {
            console.error(`[${new Date().toISOString()}] Self-ping (${url}) error:`, err);
          }
        }

        // Internal ping every 3 minutes
        ping(INTERNAL_URL);
        internalPingInterval = setInterval(() => ping(INTERNAL_URL), 180000);

        // External ping every 15 minutes
        externalPingInterval = setInterval(() => ping(EXTERNAL_URL), 900000);

        // Stop intervals on SIGTERM
        process.on('SIGTERM', () => {
          console.log('SIGTERM received — stopping self-ping');
          if (internalPingInterval) clearInterval(internalPingInterval);
          if (externalPingInterval) clearInterval(externalPingInterval);
        });
      }

      startSelfPing();
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown for email workers
process.on('SIGTERM', async () => {
  console.log('SIGTERM received — shutting down gracefully');
  await stopEmailWorkers();
  process.exit(0);
});

// Catch unhandled rejections
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
  process.exit(1);
});

bootstrap();