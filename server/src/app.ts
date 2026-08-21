import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { sandboxHealth } from './sandbox/index.js';
import { adminRouter } from './routes/admin.js';
import { aiRouter } from './routes/ai.js';
import { assessmentRouter } from './routes/assessments.js';
import { authRouter } from './routes/auth.js';
import { NotFoundError, ValidationError } from './routes/helpers.js';
import { practiceRouter } from './routes/practice.js';
import { progressRouter } from './routes/progress.js';

export function createApp() {
  const app = express();

  app.use(helmet({
    // The SPA is served from the same origin in production builds.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') }));
  app.use(express.json({ limit: '4mb' }));
  if (config.env !== 'test') app.use(morgan('dev'));

  app.get('/api/health', async (_req, res) => {
    res.json({
      status: 'ok',
      env: config.env,
      time: new Date().toISOString(),
      sandbox: await sandboxHealth(),
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/practice', practiceRouter);
  app.use('/api/progress', progressRouter);
  app.use('/api/assessments', assessmentRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/ai', aiRouter);

  // Serve the built SPA when it exists (single-container deployment).
  const clientDist = path.join(ROOT, 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^\/(?!api).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Unknown API endpoint.' });
  });

  app.use(errorHandler);
  return app;
}

function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message, issues: err.issues });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'Request body is not valid JSON.' });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  console.error('[api] unhandled error:', err);
  res.status(500).json({
    error: 'Something went wrong while handling your request.',
    detail: config.env === 'production' ? undefined : message,
  });
}
