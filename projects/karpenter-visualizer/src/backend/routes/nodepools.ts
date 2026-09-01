import { Router, type Request, type Response } from 'express';
import { getK8sClient } from '../k8s/client.js';
import { fetchAllNodePools } from '../services/resources.js';
import { asyncHandler } from '../util/errors.js';

export function buildNodePoolsRouter(): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      const client = await getK8sClient();
      const items = await fetchAllNodePools({ client });
      res.status(200).json(items);
    }),
  );

  return router;
}
