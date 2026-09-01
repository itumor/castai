/**
 * NodeClaim fixtures.
 *
 * Two NodeClaims linked to the NodePools (`default`, `gpu-spot`) and to
 * their respective Nodes (see node.ts). Capacity type comes from both
 * labels and `spec.requirements` so the summariser picks it up
 * consistently.
 */

import type { NodeClaim } from '../../src/shared/types.js';
import {
  NODEPOOL_DEFAULT_NAME,
  NODEPOOL_DEFAULT_UID,
  NODEPOOL_GPU_SPOT_NAME,
  NODEPOOL_GPU_SPOT_UID,
} from './nodepool.js';
import { DEFAULT_EC2NODECLASS_NAME } from './ec2nodeclass.js';

// Names of the Nodes these NodeClaims manage. Kept here (and re-exported
// from node.ts) to avoid circular imports between the two fixture files.
export const NODE_NAME_DEFAULT = 'ip-10-0-1-23.ec2.internal';
export const NODE_NAME_GPU_SPOT = 'ip-10-0-2-77.ec2.internal';
export const NODE_UID_DEFAULT = 'node-uid-default-0001';
export const NODE_UID_GPU_SPOT = 'node-uid-gpu-spot-0002';

export const NODECLAIM_DEFAULT_NAME = 'default-abc12';
export const NODECLAIM_DEFAULT_UID = 'nodeclaim-uid-default-0001';
export const NODECLAIM_GPU_SPOT_NAME = 'gpu-spot-xyz34';
export const NODECLAIM_GPU_SPOT_UID = 'nodeclaim-uid-gpu-spot-0002';

export const nodeClaimFixtures: NodeClaim[] = [
  {
    apiVersion: 'karpenter.sh/v1beta1',
    kind: 'NodeClaim',
    metadata: {
      name: NODECLAIM_DEFAULT_NAME,
      namespace: 'karpenter',
      uid: NODECLAIM_DEFAULT_UID,
      creationTimestamp: '2024-03-01T08:00:00Z',
      generation: 1,
      labels: {
        'karpenter.sh/nodepool': NODEPOOL_DEFAULT_NAME,
        'karpenter.sh/capacity-type': 'on-demand',
        'karpenter.k8s.aws/ec2nodeclass': DEFAULT_EC2NODECLASS_NAME,
      },
      ownerReferences: [
        {
          apiVersion: 'karpenter.sh/v1beta1',
          kind: 'NodePool',
          name: NODEPOOL_DEFAULT_NAME,
          uid: NODEPOOL_DEFAULT_UID,
          controller: true,
        },
      ],
    },
    spec: {
      nodeClassRef: {
        group: 'karpenter.k8s.aws',
        kind: 'EC2NodeClass',
        name: DEFAULT_EC2NODECLASS_NAME,
      },
      requirements: [
        {
          key: 'karpenter.sh/capacity-type',
          operator: 'In',
          values: ['on-demand'],
        },
        {
          key: 'kubernetes.io/arch',
          operator: 'In',
          values: ['amd64'],
        },
        {
          key: 'karpenter.k8s.aws/instance-category',
          operator: 'In',
          values: ['c', 'm', 'r'],
        },
        {
          key: 'topology.kubernetes.io/zone',
          operator: 'In',
          values: ['us-east-1a'],
        },
      ],
    },
    status: {
      nodeName: NODE_NAME_DEFAULT,
      providerID:
        'aws:///us-east-1a/i-0123456789abcdef0',
      instanceType: 'm5.large',
      zone: 'us-east-1a',
      region: 'us-east-1',
      architecture: 'amd64',
      os: 'linux',
      capacity: {
        cpu: '2',
        memory: '8Gi',
        pods: '29',
        'ephemeral-storage': '100Gi',
      },
      allocatable: {
        cpu: '1930m',
        memory: '7820Mi',
        pods: '29',
        'ephemeral-storage': '94Gi',
      },
      conditions: [
        {
          type: 'Ready',
          status: 'True',
          lastTransitionTime: '2024-03-01T08:02:00Z',
          reason: 'Ready',
        },
        {
          type: 'Launched',
          status: 'True',
          lastTransitionTime: '2024-03-01T08:01:00Z',
          reason: 'Launched',
        },
      ],
    },
  },
  {
    apiVersion: 'karpenter.sh/v1beta1',
    kind: 'NodeClaim',
    metadata: {
      name: NODECLAIM_GPU_SPOT_NAME,
      namespace: 'karpenter',
      uid: NODECLAIM_GPU_SPOT_UID,
      creationTimestamp: '2024-03-01T08:30:00Z',
      generation: 1,
      labels: {
        'karpenter.sh/nodepool': NODEPOOL_GPU_SPOT_NAME,
        'karpenter.sh/capacity-type': 'spot',
        'karpenter.k8s.aws/ec2nodeclass': DEFAULT_EC2NODECLASS_NAME,
      },
      ownerReferences: [
        {
          apiVersion: 'karpenter.sh/v1beta1',
          kind: 'NodePool',
          name: NODEPOOL_GPU_SPOT_NAME,
          uid: NODEPOOL_GPU_SPOT_UID,
          controller: true,
        },
      ],
    },
    spec: {
      nodeClassRef: {
        group: 'karpenter.k8s.aws',
        kind: 'EC2NodeClass',
        name: DEFAULT_EC2NODECLASS_NAME,
      },
      requirements: [
        {
          key: 'karpenter.sh/capacity-type',
          operator: 'In',
          values: ['spot'],
        },
        {
          key: 'kubernetes.io/arch',
          operator: 'In',
          values: ['amd64'],
        },
        {
          key: 'karpenter.k8s.aws/instance-category',
          operator: 'In',
          values: ['g', 'p'],
        },
        {
          key: 'topology.kubernetes.io/zone',
          operator: 'In',
          values: ['us-east-1b'],
        },
      ],
    },
    status: {
      nodeName: NODE_NAME_GPU_SPOT,
      providerID:
        'aws:///us-east-1b/i-0abcdef1234567890',
      instanceType: 'p3.2xlarge',
      zone: 'us-east-1b',
      region: 'us-east-1',
      architecture: 'amd64',
      os: 'linux',
      capacity: {
        cpu: '8',
        memory: '61Gi',
        pods: '58',
        'nvidia.com/gpu': '1',
        'ephemeral-storage': '500Gi',
      },
      allocatable: {
        cpu: '7910m',
        memory: '60100Mi',
        pods: '58',
        'nvidia.com/gpu': '1',
        'ephemeral-storage': '470Gi',
      },
      conditions: [
        {
          type: 'Ready',
          status: 'True',
          lastTransitionTime: '2024-03-01T08:32:00Z',
          reason: 'Ready',
        },
        {
          type: 'Launched',
          status: 'True',
          lastTransitionTime: '2024-03-01T08:31:00Z',
          reason: 'Launched',
        },
      ],
    },
  },
];

export function getNodeClaimByName(name: string): NodeClaim | undefined {
  return nodeClaimFixtures.find((n) => n.metadata.name === name);
}
