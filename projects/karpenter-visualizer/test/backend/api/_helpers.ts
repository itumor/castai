/**
 * Test helpers for API tests.
 *
 * Provides:
 *   - `beforeMockApp` / `afterMockApp` lifecycle hooks that set up the
 *     mock K8s client with fixture data and reset it after the test.
 */

import {
  resetK8sClient,
  setMockClusterData,
} from '../../../src/backend/k8s/client.js';
import { mockCluster } from '../../fixtures/cluster.js';

export const beforeMockApp = (): void => {
  process.env.MOCK_K8S = 'true';
  resetK8sClient();
  setMockClusterData(mockCluster);
};

export const afterMockApp = (): void => {
  resetK8sClient();
  setMockClusterData(undefined);
  delete process.env.MOCK_K8S;
};

export { mockCluster };
