import http from 'http';
import { createApp } from './app';
import { connectDB } from './db';
import { config } from './config';
import { startInsightScheduler } from './jobs/insightScheduler';
import { startAiNotificationScheduler } from './jobs/aiNotificationScheduler';
import { initSocketService } from './services/socketService';

async function main(): Promise<void> {
  await connectDB();

  const app = createApp();
  const httpServer = http.createServer(app);

  // Initialize real-time Socket.IO service
  initSocketService(httpServer);

  // Start the nightly insight computation job
  startInsightScheduler();
  startAiNotificationScheduler();

  httpServer.listen(config.port, () => {
    console.log(`[server] Lumen API listening on http://localhost:${config.port}`);
    console.log(`[server] Environment: ${config.nodeEnv}`);
  });
}

main().catch(err => {
  console.error('[server] Fatal error during startup:', err);
  process.exit(1);
});
