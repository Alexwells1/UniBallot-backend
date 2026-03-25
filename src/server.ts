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

      const SELF_URL = `https://uniballot-backend.onrender.com/health`; 
      let pinging = false;
      let pingInterval: ReturnType<typeof setInterval>;

      function startSelfPing() {
        if (pinging) return;
        pinging = true;
        console.log('✅ Self-ping started');

        async function ping() {
          try {
            const res = await fetch(SELF_URL);
            console.log(`[${new Date().toISOString()}] Self-ping status:`, res.status);
          } catch (err) {
            console.error(`[${new Date().toISOString()}] Self-ping error:`, err);
          }
        }

        ping();
        pingInterval = setInterval(ping, 180000);

        process.on('SIGTERM', () => {
          console.log('SIGTERM received — stopping self-ping');
          if (pingInterval) clearInterval(pingInterval);
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