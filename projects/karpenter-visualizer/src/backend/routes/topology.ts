import { Router, type Request, type Response } from 'express';
import { getK8sClient } from '../k8s/client.js';
import { buildTopology } from '../services/resources.js';
import { asyncHandler } from '../util/errors.js';

export function buildTopologyRouter(): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      const client = await getK8sClient();
      const topology = await buildTopology(client);
      res.status(200).json(topology);
    }),
  );

  return router;
}
