import { mainEmailWorker, retryEmailWorker } from './Emailworker.service';

export function startEmailWorkers(): void {
  console.log('[email] Starting workers...');

  // Workers are instantiated on import — these listeners confirm Redis handshake
  mainEmailWorker.on('ready', () => console.log('[email-main] ✅ Worker ready'));
  retryEmailWorker.on('ready', () => console.log('[email-retry] ✅ Worker ready'));

  console.log('[email] ✅ Workers started (main concurrency=5, retry concurrency=3)');
}

export async function stopEmailWorkers(): Promise<void> {
  console.log('[email] Shutting down workers...');
  await Promise.all([mainEmailWorker.close(), retryEmailWorker.close()]);
  console.log('[email] ✅ Workers stopped gracefully');
}