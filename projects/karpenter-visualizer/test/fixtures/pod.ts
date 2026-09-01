/**
 * Pod fixtures.
 *
 * 4 pods total:
 *   1. running-pod-default    — Running on the default (on-demand) Node
 *   2. running-pod-gpu        — Running on the gpu-spot Node
 *   3. pending-pod-advanced   — Pending, with rich scheduling evidence
 *                                 (requests, nodeSelector, affinity, tolerations,
 *                                 topology spread, architecture / zone preferences)
 *   4. pending-pod-simple     — Pending, simpler requirements
 */

import type { V1Pod } from '@kubernetes/client-node';
import {
  NODE_NAME_DEFAULT,
  NODE_NAME_GPU_SPOT,
} from './node.js';

export const POD_RUNNING_DEFAULT_NAME = 'api-7c9b-abc';
export const POD_RUNNING_DEFAULT_UID = 'pod-uid-running-default-0001';

export const POD_RUNNING_GPU_NAME = 'trainer-5d8f-xyz';
export const POD_RUNNING_GPU_UID = 'pod-uid-running-gpu-0002';

export const POD_PENDING_ADVANCED_NAME = 'batch-processor-1';
export const POD_PENDING_ADVANCED_UID = 'pod-uid-pending-advanced-0003';

export const POD_PENDING_SIMPLE_NAME = 'metrics-scraper';
export const POD_PENDING_SIMPLE_UID = 'pod-uid-pending-simple-0004';

export const podFixtures: V1Pod[] = [
  {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: POD_RUNNING_DEFAULT_NAME,
      namespace: 'prod',
      uid: POD_RUNNING_DEFAULT_UID,
      creationTimestamp: '2024-03-01T08:05:00Z',
      labels: {
        app: 'api',
        'pod-template-hash': '7c9b',
        'karpenter.sh/nodepool': 'default',
      },
      ownerReferences: [
        {
          apiVersion: 'apps/v1',
          kind: 'ReplicaSet',
          name: 'api-7c9b',
          controller: true,
        },
      ],
    },
    spec: {
      nodeName: NODE_NAME_DEFAULT,
      containers: [
        {
          name: 'api',
          image: 'ghcr.io/example/api:1.2.3',
          resources: {
            requests: {
              cpu: '250m',
              memory: '256Mi',
              'ephemeral-storage': '1Gi',
            },
            limits: {
              cpu: '500m',
              memory: '512Mi',
            },
          },
        },
      ],
    },
    status: {
      phase: 'Running',
      podIP: '10.0.10.15',
      hostIP: '10.0.1.23',
      conditions: [
        {
          type: 'Ready',
          status: 'True',
          lastTransitionTime: '2024-03-01T08:05:30Z',
        },
        {
          type: 'ContainersReady',
          status: 'True',
          lastTransitionTime: '2024-03-01T08:05:30Z',
        },
      ],
    },
  },
  {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: POD_RUNNING_GPU_NAME,
      namespace: 'ml',
      uid: POD_RUNNING_GPU_UID,
      creationTimestamp: '2024-03-01T08:35:00Z',
      labels: {
        app: 'trainer',
        'pod-template-hash': '5d8f',
        workload: 'gpu-training',
        'karpenter.sh/nodepool': 'gpu-spot',
      },
      ownerReferences: [
        {
          apiVersion: 'apps/v1',
          kind: 'ReplicaSet',
          name: 'trainer-5d8f',
          controller: true,
        },
      ],
    },
    spec: {
      nodeName: NODE_NAME_GPU_SPOT,
      tolerations: [
        {
          key: 'karpenter.sh/unregistered',
          operator: 'Exists',
          effect: 'NoExecute',
        },
      ],
      containers: [
        {
          name: 'trainer',
          image: 'ghcr.io/example/trainer:0.9.0',
          resources: {
            requests: {
              cpu: '4',
              memory: '16Gi',
              'nvidia.com/gpu': '1',
            },
            limits: {
              cpu: '8',
              memory: '32Gi',
              'nvidia.com/gpu': '1',
            },
          },
        },
      ],
    },
    status: {
      phase: 'Running',
      podIP: '10.0.20.45',
      hostIP: '10.0.2.77',
      conditions: [
        {
          type: 'Ready',
          status: 'True',
          lastTransitionTime: '2024-03-01T08:35:30Z',
        },
      ],
    },
  },
  {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: POD_PENDING_ADVANCED_NAME,
      namespace: 'batch',
      uid: POD_PENDING_ADVANCED_UID,
      creationTimestamp: '2024-03-02T10:00:00Z',
      labels: {
        app: 'batch-processor',
        tier: 'batch',
        'karpenter.sh/nodepool': 'gpu-spot',
        'karpenter.sh/capacity-type': 'spot',
      },
    },
    spec: {
      containers: [
        {
          name: 'worker',
          image: 'ghcr.io/example/batch:2.1.0',
          resources: {
            requests: {
              cpu: '2',
              memory: '8Gi',
              'nvidia.com/gpu': '1',
            },
            limits: {
              cpu: '4',
              memory: '16Gi',
              'nvidia.com/gpu': '1',
            },
          },
        },
      ],
      nodeSelector: {
        'karpenter.sh/capacity-type': 'spot',
        'karpenter.k8s.aws/instance-category': 'g',
      },
      affinity: {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [
                  {
                    key: 'kubernetes.io/arch',
                    operator: 'In',
                    values: ['amd64'],
                  },
                  {
                    key: 'topology.kubernetes.io/zone',
                    operator: 'In',
                    values: ['us-east-1a', 'us-east-1b'],
                  },
                  {
                    key: 'node.kubernetes.io/instance-type',
                    operator: 'In',
                    values: ['p3.2xlarge', 'p3.8xlarge', 'g5.xlarge'],
                  },
                ],
              },
            ],
          },
        },
        podAntiAffinity: {
          preferredDuringSchedulingIgnoredDuringExecution: [
            {
              weight: 100,
              podAffinityTerm: {
                labelSelector: {
                  matchLabels: {
                    app: 'batch-processor',
                  },
                },
                topologyKey: 'kubernetes.io/hostname',
              },
            },
          ],
        },
      },
      topologySpreadConstraints: [
        {
          maxSkew: 1,
          topologyKey: 'topology.kubernetes.io/zone',
          whenUnsatisfiable: 'DoNotSchedule',
          labelSelector: {
            matchLabels: {
              app: 'batch-processor',
            },
          },
        },
        {
          maxSkew: 2,
          topologyKey: 'kubernetes.io/hostname',
          whenUnsatisfiable: 'ScheduleAnyway',
          labelSelector: {
            matchLabels: {
              tier: 'batch',
            },
          },
        },
      ],
      tolerations: [
        {
          key: 'karpenter.sh/unregistered',
          operator: 'Exists',
          effect: 'NoExecute',
          tolerationSeconds: 300,
        },
        {
          key: 'nvidia.com/gpu',
          operator: 'Exists',
          effect: 'NoSchedule',
        },
      ],
      runtimeClassName: 'gvisor',
    },
    status: {
      phase: 'Pending',
      conditions: [
        {
          type: 'PodScheduled',
          status: 'False',
          lastTransitionTime: '2024-03-02T10:00:05Z',
          reason: 'Unschedulable',
          message:
            '0/2 nodes are available: 1 insufficient nvidia.com/gpu, 1 node(s) had untolerated taint {karpenter.sh/unregistered: true}.',
        },
      ],
    },
  },
  {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: POD_PENDING_SIMPLE_NAME,
      namespace: 'monitoring',
      uid: POD_PENDING_SIMPLE_UID,
      creationTimestamp: '2024-03-02T10:05:00Z',
      labels: {
        app: 'metrics-scraper',
        tier: 'monitoring',
        'karpenter.sh/nodepool': 'default',
      },
    },
    spec: {
      containers: [
        {
          name: 'scraper',
          image: 'ghcr.io/example/scraper:0.1.0',
          resources: {
            requests: {
              cpu: '100m',
              memory: '128Mi',
            },
            limits: {
              cpu: '200m',
              memory: '256Mi',
            },
          },
        },
      ],
      nodeSelector: {
        'kubernetes.io/os': 'linux',
      },
      tolerations: [
        {
          key: 'dedicated',
          operator: 'Equal',
          value: 'monitoring',
          effect: 'NoSchedule',
        },
      ],
    },
    status: {
      phase: 'Pending',
      conditions: [
        {
          type: 'PodScheduled',
          status: 'False',
          lastTransitionTime: '2024-03-02T10:05:05Z',
          reason: 'Unschedulable',
          message:
            '0/2 nodes are available: 1 node(s) didn\'t match node selector, 1 node(s) had untolerated taint {dedicated=monitoring:NoSchedule}.',
        },
      ],
    },
  },
];

export function getPodByName(name: string): V1Pod | undefined {
  return podFixtures.find((p) => p.metadata?.name === name);
}
