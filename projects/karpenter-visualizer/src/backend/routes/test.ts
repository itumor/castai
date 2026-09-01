/**
 * Test-only routes.
 *
 * These endpoints exist to drive the E2E tests against the in-memory
 * mock cluster client. They are registered ONLY when `MOCK_K8S=true`,
 * which the read-only real client refuses to honour. In other words,
 * the endpoints never reach a real Kubernetes API and do not violate
 * the read-only guarantee of this project.
 *
 * Endpoints:
 *   POST /api/_test/seed         body = MockClusterData  (full replace)
 *   POST /api/_test/schedule     body = { podName, podNamespace, nodeName }
 *                                marks the named pod Running on the given
 *                                node and emits a Scheduled event. Returns
 *                                the updated MockClusterData.
 */

import { Router, type Request, type Response } from 'express';
import type { CoreV1Event, V1Pod } from '@kubernetes/client-node';
import type {
  MockClusterData,
} from '../k8s/client.js';
import { setMockClusterData, getMockClusterData } from '../k8s/client.js';
import { asyncHandler } from '../util/errors.js';

export function buildTestRouter(): Router {
  const router = Router();

  router.post(
    '/seed',
    asyncHandler(async (req: Request, res: Response) => {
      const data = req.body as MockClusterData | undefined;
      if (!data || typeof data !== 'object') {
        res.status(400).json({ error: 'body must be a MockClusterData object' });
        return;
      }
      setMockClusterData(data);
      res.status(200).json({ ok: true });
    }),
  );

  router.post(
    '/schedule',
    asyncHandler(async (req: Request, res: Response) => {
      const { podName, podNamespace, nodeName } = (req.body ?? {}) as {
        podName?: string;
        podNamespace?: string;
        nodeName?: string;
      };
      if (!podName || !podNamespace || !nodeName) {
        res.status(400).json({
          error: 'podName, podNamespace, and nodeName are required',
        });
        return;
      }

      const current = getMockClusterData();
      if (!current) {
        res.status(409).json({
          error: 'no mock cluster data has been loaded yet',
        });
        return;
      }

      const now = new Date();
      const newEvent: CoreV1Event = {
        apiVersion: 'v1',
        kind: 'Event',
        metadata: {
          name: `${podName}-scheduled-${now.getTime()}`,
          namespace: podNamespace,
          uid: `event-test-${now.getTime()}`,
          creationTimestamp: now,
        },
        involvedObject: {
          kind: 'Pod',
          namespace: podNamespace,
          name: podName,
          apiVersion: 'v1',
        },
        reason: 'Scheduled',
        message: `Successfully assigned ${podNamespace}/${podName} to ${nodeName}`,
        type: 'Normal',
        firstTimestamp: new Date(),
        lastTimestamp: new Date(),
        count: 1,
        source: { component: 'default-scheduler' },
      };

      const updated: MockClusterData = {
        nodePools: [...current.nodePools],
        nodeClaims: [...current.nodeClaims],
        ec2NodeClasses: [...current.ec2NodeClasses],
        nodes: [...current.nodes],
        pods: current.pods.map((pod): V1Pod => {
          if (
            pod.metadata?.name === podName &&
            pod.metadata?.namespace === podNamespace
          ) {
            return {
              ...pod,
              spec: { ...(pod.spec ?? {}), nodeName },
              status: {
                ...(pod.status ?? {}),
                phase: 'Running',
                podIP: pod.status?.podIP ?? '10.0.99.99',
                hostIP: pod.status?.hostIP ?? '10.0.99.1',
              },
            } as unknown as V1Pod;
          }
          return pod;
        }),
        events: [...current.events, newEvent],
      };

      setMockClusterData(updated);
      res.status(200).json({ ok: true, pods: updated.pods.length });
    }),
  );

  return router;
}
