import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './lib/env.js';

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

const app = express();

// Security middleware
app.use(helmet());
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

const PORT = env.PORT;
app.listen(PORT, () => {
  console.log(`[SERVER] Automation OS running on port ${PORT} (${env.NODE_ENV})`);
});

export default app;
