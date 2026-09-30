import { createApp } from './app';
import { connectDB } from './db';
import { config } from './config';
import { startInsightScheduler } from './jobs/insightScheduler';

async function main(): Promise<void> {
  await connectDB();

  const app = createApp();

  // Start the nightly insight computation job
  startInsightScheduler();

  app.listen(config.port, () => {
    console.log(`[server] Lumen API listening on http://localhost:${config.port}`);
    console.log(`[server] Environment: ${config.nodeEnv}`);
  });
}

main().catch(err => {
  console.error('[server] Fatal error during startup:', err);
  process.exit(1);
});
