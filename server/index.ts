import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './lib/env.js';
import { seedPermissions } from './services/permissionSeedService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Routes
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import organisationsRouter from './routes/organisations.js';
import usersRouter from './routes/users.js';
import enginesRouter from './routes/engines.js';
import categoriesRouter from './routes/categories.js';
import tasksRouter from './routes/tasks.js';
import permissionGroupsRouter from './routes/permissionGroups.js';
import executionsRouter from './routes/executions.js';
import filesRouter from './routes/files.js';
import systemUsersRouter from './routes/systemUsers.js';
import systemSettingsRouter from './routes/systemSettings.js';
import systemExecutionsRouter from './routes/systemExecutions.js';
import webhooksRouter from './routes/webhooks.js';

const app = express();

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: false,
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: env.CORS_ORIGINS === '*' ? '*' : env.CORS_ORIGINS.split(',').map(o => o.trim()),
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use(healthRouter);
app.use(authRouter);
app.use(organisationsRouter);
app.use(usersRouter);
app.use(enginesRouter);
app.use(categoriesRouter);
app.use(tasksRouter);
app.use(permissionGroupsRouter);
app.use(executionsRouter);
app.use(filesRouter);
app.use(systemUsersRouter);
app.use(systemSettingsRouter);
app.use(systemExecutionsRouter);
app.use(webhooksRouter);

// Serve static files in production
if (env.NODE_ENV === 'production') {
  const clientDistPath = path.resolve(__dirname, '../dist/client');
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// 404 handler for API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[SERVER ERROR]', err);
  const e = err as { status?: number; statusCode?: number; message?: string };
  res.status(e.status ?? e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
});

async function start() {
  await seedPermissions();
  const PORT = env.NODE_ENV === 'production' ? 5000 : env.PORT;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Automation OS running on port ${PORT} (${env.NODE_ENV})`);
  });
}

start().catch((err) => {
  console.error('[SERVER] Startup failed', err);
  process.exit(1);
});

export default app;
