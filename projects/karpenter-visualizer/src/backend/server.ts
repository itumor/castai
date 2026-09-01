import express, { type Express, type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApiRouter } from './routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3001);
const NODE_ENV = process.env.NODE_ENV ?? 'development';

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.use('/api', buildApiRouter());

  if (NODE_ENV === 'production') {
    const frontendDir = path.resolve(
      process.cwd(),
      process.env.FRONTEND_DIST_DIR ?? 'dist/frontend',
    );
    app.use(express.static(frontendDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(frontendDir, 'index.html'));
    });
  }

  return app;
}

const isDirectRun = (() => {
  if (typeof process === 'undefined' || !process.argv[1]) return false;
  try {
    return path.resolve(process.argv[1]) === path.resolve(__filename);
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  const app = createApp();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[karpenter-visualizer] backend listening on http://localhost:${PORT}`);
  });
}
