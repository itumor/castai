import { Router, type Request, type Response } from 'express';
import { getK8sClient } from '../k8s/client.js';
import { fetchPendingPods } from '../services/resources.js';
import { asyncHandler } from '../util/errors.js';
import type { PendingPodResponse } from '../../shared/types.js';

export function buildPendingPodsRouter(): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      const client = await getK8sClient();
      const items = await fetchPendingPods(client);
      const body: PendingPodResponse = {
        items,
        totalCount: items.length,
        generatedAt: new Date().toISOString(),
      };
      res.status(200).json(body);
    }),
  );

  return router;
}
