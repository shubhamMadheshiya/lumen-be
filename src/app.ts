import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import mongoose from 'mongoose';

import { config } from './config';
import { authRouter } from './routes/auth';
import { configRouter } from './routes/config';
import { templatesRouter } from './routes/templates';
import { daySessionsRouter } from './routes/daySessions';
import { logsRouter } from './routes/logs';
import { syncRouter } from './routes/sync';
import { mediaRouter } from './routes/media';
import { insightsRouter } from './routes/insights';
import { reportsRouter } from './routes/reports';
import { remindersRouter } from './routes/reminders';
import { activitySessionsRouter } from './routes/activitySessions';

export function createApp(): Application {
  const app = express();

  // ── Security ──────────────────────────────────
  app.use(helmet());
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // ── Rate limiting ──────────────────────────────
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.isDev ? 10000 : 300,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

  // ── Body parsing ──────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(compression());

  // ── Logging ───────────────────────────────────
  app.use(morgan(config.isDev ? 'dev' : 'combined'));

  // ── Health / Alive checks ──────────────────────
  const aliveHandler = (_req: Request, res: Response) => {
    const dbState = mongoose.connection.readyState;
    const dbStatus = dbState === 1 ? 'connected' : dbState === 2 ? 'connecting' : 'disconnected';

    res.status(200).json({
      status: 'alive',
      message: 'Lumen API is alive and kicking! 🚀',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database: dbStatus,
    });
  };

  app.get('/', aliveHandler);
  app.get('/alive', aliveHandler);
  app.get('/health', aliveHandler);
  app.get('/healthz', aliveHandler);

  // ── API routes ────────────────────────────────
  const v1 = '/api/v1';
  app.get(`${v1}/alive`, aliveHandler);
  app.get(`${v1}/health`, aliveHandler);
  app.use(`${v1}/auth`,              authRouter);
  app.all(`${v1}/me`, (req: Request, res: Response, next: NextFunction) => {
    req.url = '/me';
    authRouter(req, res, next);
  });
  app.use(`${v1}/config`,            configRouter);
  ['/categories', '/questions', '/options', '/quick-actions', '/units'].forEach(subPath => {
    app.use(`${v1}${subPath}`, (req: Request, res: Response, next: NextFunction) => {
      req.url = subPath + (req.url === '/' ? '' : req.url);
      configRouter(req, res, next);
    });
  });
  app.use(`${v1}/templates`,         templatesRouter);
  app.use(`${v1}/day-sessions`,      daySessionsRouter);
  app.use(`${v1}/logs`,              logsRouter);
  app.use(`${v1}/sync`,              syncRouter);
  app.use(`${v1}/media`,             mediaRouter);
  app.use(`${v1}/insights`,          insightsRouter);
  app.use(`${v1}/reports`,           reportsRouter);
  app.use(`${v1}/reminders`,         remindersRouter);
  app.use(`${v1}/activity-sessions`, activitySessionsRouter);

  // ── 404 ───────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ success: false, message: 'Route not found' });
  });

  // ── Global error handler ──────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error & { statusCode?: number; errors?: unknown[] }, _req: Request, res: Response, _next: NextFunction) => {
    const statusCode = err.statusCode ?? 500;
    if (config.isDev) console.error(err);
    res.status(statusCode).json({
      success: false,
      message: err.message ?? 'Internal server error',
      ...(config.isDev && { stack: err.stack }),
      ...(err.errors && { errors: err.errors }),
    });
  });

  return app;
}
