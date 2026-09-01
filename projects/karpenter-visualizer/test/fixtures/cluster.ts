/**
 * Mock cluster aggregate.
 *
 * Exports the full collection of fixtures used when `MOCK_K8S=true`.
 * Consumers (mock client, tests) import from this single module so
 * the cluster stays internally consistent.
 */

import type { V1Node, V1Pod, CoreV1Event } from '@kubernetes/client-node';
import type {
  NodePool,
  NodeClaim,
  EC2NodeClass,
} from '../../src/shared/types.js';

import { nodePoolFixtures } from './nodepool.js';
import { nodeClaimFixtures } from './nodeclaim.js';
import { ec2NodeClassFixtures } from './ec2nodeclass.js';
import { nodeFixtures } from './node.js';
import { podFixtures } from './pod.js';
import { eventFixtures } from './event.js';

export interface MockCluster {
  nodePools: NodePool[];
  nodeClaims: NodeClaim[];
  ec2NodeClasses: EC2NodeClass[];
  nodes: V1Node[];
  pods: V1Pod[];
  events: CoreV1Event[];
}

export const mockCluster: MockCluster = {
  nodePools: nodePoolFixtures,
  nodeClaims: nodeClaimFixtures,
  ec2NodeClasses: ec2NodeClassFixtures,
  nodes: nodeFixtures,
  pods: podFixtures,
  events: eventFixtures,
};

// Re-exports for convenience
export {
  nodePoolFixtures,
  nodeClaimFixtures,
  ec2NodeClassFixtures,
  nodeFixtures,
  podFixtures,
  eventFixtures,
};
