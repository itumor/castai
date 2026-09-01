import { Router, type Request, type Response } from 'express';
import { getK8sClient } from '../k8s/client.js';
import { fetchAllNodeClaims } from '../services/resources.js';
import { asyncHandler } from '../util/errors.js';

export function buildNodeClaimsRouter(): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req: Request, res: Response) => {
      const client = await getK8sClient();
      const items = await fetchAllNodeClaims({ client });
      res.status(200).json(items);
    }),
  );

  return router;
}
