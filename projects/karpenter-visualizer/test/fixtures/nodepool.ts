/**
 * NodePool fixtures.
 *
 * Two NodePools (`default`, `gpu-spot`) referencing the same EC2NodeClass.
 * The fixtures include realistic Karpenter v1 NodePool fields such as
 * `spec.template.spec.requirements`, `spec.disruption`, `spec.limits` and a
 * `nodeClassRef`.
 */

import type { NodePool } from '../../src/shared/types.js';
import { DEFAULT_EC2NODECLASS_NAME } from './ec2nodeclass.js';

export const NODEPOOL_DEFAULT_NAME = 'default';
export const NODEPOOL_DEFAULT_UID = 'nodepool-uid-default-0001';
export const NODEPOOL_GPU_SPOT_NAME = 'gpu-spot';
export const NODEPOOL_GPU_SPOT_UID = 'nodepool-uid-gpu-spot-0002';

export const nodePoolFixtures: NodePool[] = [
  {
    apiVersion: 'karpenter.sh/v1beta1',
    kind: 'NodePool',
    metadata: {
      name: NODEPOOL_DEFAULT_NAME,
      namespace: 'karpenter',
      uid: NODEPOOL_DEFAULT_UID,
      creationTimestamp: '2024-01-15T12:00:00Z',
      generation: 3,
      labels: {
        'app.kubernetes.io/managed-by': 'karpenter-visualizer-fixtures',
        'karpenter.sh/discovery': 'prod-cluster',
      },
    },
    spec: {
      template: {
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
              values: ['on-demand', 'spot'],
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
              key: 'karpenter.k8s.aws/instance-generation',
              operator: 'Gt',
              values: ['4'],
            },
            {
              key: 'topology.kubernetes.io/zone',
              operator: 'In',
              values: ['us-east-1a', 'us-east-1b', 'us-east-1c'],
            },
          ],
        },
      },
      disruption: {
        consolidationPolicy: 'WhenUnderutilized',
        expireAfter: '720h',
      },
      limits: {
        cpu: '200',
        memory: '800Gi',
      },
      weight: 10,
    },
    status: {
      conditions: [
        {
          type: 'Ready',
          status: 'True',
          lastTransitionTime: '2024-01-15T12:01:00Z',
          reason: 'ReconciliationSucceeded',
        },
      ],
      nodeClassStable: {
        name: DEFAULT_EC2NODECLASS_NAME,
        kind: 'EC2NodeClass',
        group: 'karpenter.k8s.aws',
      },
    },
  },
  {
    apiVersion: 'karpenter.sh/v1beta1',
    kind: 'NodePool',
    metadata: {
      name: NODEPOOL_GPU_SPOT_NAME,
      namespace: 'karpenter',
      uid: NODEPOOL_GPU_SPOT_UID,
      creationTimestamp: '2024-02-01T09:30:00Z',
      generation: 1,
      labels: {
        'app.kubernetes.io/managed-by': 'karpenter-visualizer-fixtures',
        workload: 'gpu',
      },
    },
    spec: {
      template: {
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
              key: 'karpenter.k8s.aws/instance-generation',
              operator: 'Gt',
              values: ['4'],
            },
          ],
        },
      },
      disruption: {
        consolidationPolicy: 'WhenUnderutilized',
        expireAfter: '168h',
      },
      weight: 50,
    },
    status: {
      conditions: [
        {
          type: 'Ready',
          status: 'True',
          lastTransitionTime: '2024-02-01T09:31:00Z',
          reason: 'ReconciliationSucceeded',
        },
      ],
    },
  },
];

export function getNodePoolByName(name: string): NodePool | undefined {
  return nodePoolFixtures.find((p) => p.metadata.name === name);
}
