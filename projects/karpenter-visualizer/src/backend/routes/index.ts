import { Router, type Request, type Response } from 'express';
import type { HealthResponse } from '../../shared/types.js';
import { errorMiddleware } from '../util/errors.js';
import { buildNodePoolsRouter } from './nodepools.js';
import { buildNodeClaimsRouter } from './nodeclaims.js';
import { buildEC2NodeClassesRouter } from './ec2nodeclasses.js';
import { buildNodesRouter } from './nodes.js';
import { buildPodsRouter } from './pods.js';
import { buildEventsRouter } from './events.js';
import { buildTopologyRouter } from './topology.js';
import { buildPendingPodsRouter } from './pending-pods.js';
import { isMockMode } from '../k8s/client.js';
import { buildTestRouter } from './test.js';

const startedAt = Date.now();

export function buildApiRouter(): Router {
  const router = Router();

  router.get('/healthz', (_req: Request, res: Response) => {
    const body: HealthResponse = {
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
    res.status(200).json(body);
  });

  // Resource routers. All routes are read-only by design — see
  // src/backend/k8s/client.ts for the read-only guarantee comment.
  router.use('/nodepools', buildNodePoolsRouter());
  router.use('/nodeclaims', buildNodeClaimsRouter());
  router.use('/ec2nodeclasses', buildEC2NodeClassesRouter());
  router.use('/nodes', buildNodesRouter());
  router.use('/pods', buildPodsRouter());
  router.use('/events', buildEventsRouter());
  router.use('/topology', buildTopologyRouter());
  router.use('/pending-pods', buildPendingPodsRouter());

  // Test-only routes. Mounted only when the in-memory mock client is
  // active so they can never reach a real Kubernetes API.
  if (isMockMode()) {
    router.use('/_test', buildTestRouter());
  }

  // Centralised error responder. Must be last.
  router.use(errorMiddleware);

  return router;
}
