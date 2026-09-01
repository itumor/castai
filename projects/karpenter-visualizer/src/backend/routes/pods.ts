import { Router, type Request, type Response } from 'express';
import { getK8sClient } from '../k8s/client.js';
import { fetchAllPods } from '../services/resources.js';
import { asyncHandler } from '../util/errors.js';

export function buildPodsRouter(): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      const client = await getK8sClient();
      const ns =
        typeof req.query.namespace === 'string' ? req.query.namespace : undefined;
      const items = await fetchAllPods(client, ns);
      res.status(200).json(items);
    }),
  );

  return router;
}
