/**
 * Node fixtures.
 *
 * Two Nodes (one spot, one on-demand) that mirror the NodeClaims
 * above. Labels include the standard Karpenter/k8s labels so the
 * `summariseNode` builder picks up instance type, zone, arch,
 * capacity-type, NodeClaim and NodePool references.
 */

import type { V1Node } from '@kubernetes/client-node';
import {
  NODEPOOL_DEFAULT_NAME,
  NODEPOOL_GPU_SPOT_NAME,
} from './nodepool.js';
import {
  NODECLAIM_DEFAULT_NAME,
  NODECLAIM_GPU_SPOT_NAME,
  NODE_NAME_DEFAULT,
  NODE_NAME_GPU_SPOT,
  NODE_UID_DEFAULT,
  NODE_UID_GPU_SPOT,
} from './nodeclaim.js';

export {
  NODE_NAME_DEFAULT,
  NODE_NAME_GPU_SPOT,
  NODE_UID_DEFAULT,
  NODE_UID_GPU_SPOT,
};

export const nodeFixtures: V1Node[] = [
  {
    apiVersion: 'v1',
    kind: 'Node',
    metadata: {
      name: NODE_NAME_DEFAULT,
      uid: NODE_UID_DEFAULT,
      creationTimestamp: '2024-03-01T08:02:00Z',
      labels: {
        'karpenter.sh/nodepool': NODEPOOL_DEFAULT_NAME,
        'karpenter.sh/nodeclaim': NODECLAIM_DEFAULT_NAME,
        'karpenter.sh/capacity-type': 'on-demand',
        'karpenter.k8s.aws/instance-type': 'm5.large',
        'karpenter.k8s.aws/instance-cpu': '2',
        'karpenter.k8s.aws/instance-memory': '8192',
        'topology.kubernetes.io/zone': 'us-east-1a',
        'topology.kubernetes.io/region': 'us-east-1',
        'kubernetes.io/arch': 'amd64',
        'kubernetes.io/os': 'linux',
        'node.kubernetes.io/instance-type': 'm5.large',
        'beta.kubernetes.io/os': 'linux',
      },
      annotations: {
        'karpenter.sh/managed-by': 'karpenter',
      },
    },
    spec: {
      providerID: 'aws:///us-east-1a/i-0123456789abcdef0',
      unschedulable: false,
    },
    status: {
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
          lastTransitionTime: '2024-03-01T08:03:00Z',
          reason: 'KubeletReady',
          message: 'kubelet is posting ready status',
        },
        {
          type: 'MemoryPressure',
          status: 'False',
          lastTransitionTime: '2024-03-01T08:03:00Z',
          reason: 'KubeletHasSufficientMemory',
        },
        {
          type: 'DiskPressure',
          status: 'False',
          lastTransitionTime: '2024-03-01T08:03:00Z',
          reason: 'KubeletHasNoDiskPressure',
        },
        {
          type: 'PIDPressure',
          status: 'False',
          lastTransitionTime: '2024-03-01T08:03:00Z',
          reason: 'KubeletHasSufficientPID',
        },
      ],
      addresses: [
        { type: 'InternalIP', address: '10.0.1.23' },
        { type: 'ExternalIP', address: '54.10.20.30' },
        { type: 'InternalDNS', address: NODE_NAME_DEFAULT },
        { type: 'Hostname', address: NODE_NAME_DEFAULT },
      ],
    },
  },
  {
    apiVersion: 'v1',
    kind: 'Node',
    metadata: {
      name: NODE_NAME_GPU_SPOT,
      uid: NODE_UID_GPU_SPOT,
      creationTimestamp: '2024-03-01T08:32:00Z',
      labels: {
        'karpenter.sh/nodepool': NODEPOOL_GPU_SPOT_NAME,
        'karpenter.sh/nodeclaim': NODECLAIM_GPU_SPOT_NAME,
        'karpenter.sh/capacity-type': 'spot',
        'karpenter.k8s.aws/instance-type': 'p3.2xlarge',
        'karpenter.k8s.aws/instance-cpu': '8',
        'karpenter.k8s.aws/instance-memory': '62464',
        'karpenter.k8s.aws/instance-gpu-name': 'v100',
        'karpenter.k8s.aws/instance-gpu-count': '1',
        'topology.kubernetes.io/zone': 'us-east-1b',
        'topology.kubernetes.io/region': 'us-east-1',
        'kubernetes.io/arch': 'amd64',
        'kubernetes.io/os': 'linux',
        'node.kubernetes.io/instance-type': 'p3.2xlarge',
        'beta.kubernetes.io/os': 'linux',
      },
      annotations: {
        'karpenter.sh/managed-by': 'karpenter',
      },
      taints: [
        {
          key: 'karpenter.sh/unregistered',
          value: 'true',
          effect: 'NoExecute',
        },
      ],
    },
    spec: {
      providerID: 'aws:///us-east-1b/i-0abcdef1234567890',
      unschedulable: false,
    },
    status: {
      capacity: {
        cpu: '8',
        memory: '61Gi',
        pods: '58',
        'ephemeral-storage': '500Gi',
        'nvidia.com/gpu': '1',
      },
      allocatable: {
        cpu: '7910m',
        memory: '60100Mi',
        pods: '58',
        'ephemeral-storage': '470Gi',
        'nvidia.com/gpu': '1',
      },
      conditions: [
        {
          type: 'Ready',
          status: 'True',
          lastTransitionTime: '2024-03-01T08:33:00Z',
          reason: 'KubeletReady',
        },
        {
          type: 'MemoryPressure',
          status: 'False',
          lastTransitionTime: '2024-03-01T08:33:00Z',
          reason: 'KubeletHasSufficientMemory',
        },
      ],
      addresses: [
        { type: 'InternalIP', address: '10.0.2.77' },
        { type: 'InternalDNS', address: NODE_NAME_GPU_SPOT },
        { type: 'Hostname', address: NODE_NAME_GPU_SPOT },
      ],
    },
  },
];

export function getNodeByName(name: string): V1Node | undefined {
  return nodeFixtures.find((n) => n.metadata?.name === name);
}
