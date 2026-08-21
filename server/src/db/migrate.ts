import { db, migrate } from './index.js';
import { config } from '../config.js';

migrate(db());
console.log(`✓ schema applied to ${config.databaseFile}`);
