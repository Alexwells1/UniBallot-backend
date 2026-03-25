import { env } from './config/env';
import { connectDatabase } from './config/database';
import app from './app';
import { startEmailWorkers, stopEmailWorkers } from './services/email/Emailworkers.bootstrap';

const PORT = parseInt(env.PORT, 10);

async function bootstrap(): Promise<void> {
  try {
    await connectDatabase();
    console.log('[server] ✅ MongoDB connected');

    startEmailWorkers(); // ← this was missing
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT} [${env.NODE_ENV}]`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  console.log('SIGTERM received — shutting down gracefully');
  await stopEmailWorkers();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
  process.exit(1);
});

bootstrap();