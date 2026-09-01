import { Router, type Request, type Response } from 'express';
import { getK8sClient } from '../k8s/client.js';
import { fetchAllNodes } from '../services/resources.js';
import { asyncHandler } from '../util/errors.js';

export function buildNodesRouter(): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      const client = await getK8sClient();
      const items = await fetchAllNodes(client);
      res.status(200).json(items);
    }),
  );

  return router;
}
