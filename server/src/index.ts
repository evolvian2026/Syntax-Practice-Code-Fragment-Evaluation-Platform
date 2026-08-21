import { createApp } from './app.js';
import { config } from './config.js';
import { db, migrate } from './db/index.js';

migrate(db());

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Syntax Practice API listening on http://localhost:${config.port}`);
  console.log(`  database : ${config.databaseFile}`);
  console.log(`  sandbox  : ${config.sandbox.driver}`);
  console.log(`  AI tutor : ${config.ai.apiKey ? 'enabled' : 'disabled (no ANTHROPIC_API_KEY)'}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
