import { createApp } from './app.js';
import { config } from './config.js';
import { closeDatabase, db, migrate } from './db/index.js';
import { enforceProductionGuard } from './productionGuard.js';

enforceProductionGuard();
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
    // Closing SQLite folds its write-ahead log back into the database file,
    // so the file on the volume is complete on its own when a container is
    // replaced — and a plain copy of it is a usable backup.
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
  });
}
