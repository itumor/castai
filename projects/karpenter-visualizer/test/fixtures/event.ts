/**
 * Event fixtures.
 *
 * Two Events referencing Karpenter objects (a NodeClaim and a Pod) so
 * the events route returns useful, filtered output.
 */

import type { CoreV1Event } from '@kubernetes/client-node';
import {
  NODECLAIM_DEFAULT_NAME,
  NODECLAIM_DEFAULT_UID,
} from './nodeclaim.js';
import { POD_RUNNING_DEFAULT_NAME, POD_RUNNING_DEFAULT_UID } from './pod.js';

export const eventFixtures: CoreV1Event[] = [
  {
    apiVersion: 'v1',
    kind: 'Event',
    metadata: {
      name: 'default-abc12-created',
      namespace: 'karpenter',
      uid: 'event-uid-0001',
      creationTimestamp: '2024-03-01T08:00:05Z',
    },
    involvedObject: {
      kind: 'NodeClaim',
      namespace: 'karpenter',
      name: NODECLAIM_DEFAULT_NAME,
      uid: NODECLAIM_DEFAULT_UID,
      apiVersion: 'karpenter.sh/v1beta1',
    },
    reason: 'Created',
    message: 'Created instance i-0123456789abcdef0 on AWS',
    type: 'Normal',
    firstTimestamp: '2024-03-01T08:00:05Z',
    lastTimestamp: '2024-03-01T08:00:05Z',
    count: 1,
    source: { component: 'karpenter' },
  },
  {
    apiVersion: 'v1',
    kind: 'Event',
    metadata: {
      name: 'api-7c9b-scheduled',
      namespace: 'prod',
      uid: 'event-uid-0002',
      creationTimestamp: '2024-03-01T08:05:05Z',
    },
    involvedObject: {
      kind: 'Pod',
      namespace: 'prod',
      name: POD_RUNNING_DEFAULT_NAME,
      uid: POD_RUNNING_DEFAULT_UID,
      apiVersion: 'v1',
    },
    reason: 'Scheduled',
    message: `Successfully assigned ${POD_RUNNING_DEFAULT_NAME} to ${NODECLAIM_DEFAULT_NAME}`,
    type: 'Normal',
    firstTimestamp: '2024-03-01T08:05:05Z',
    lastTimestamp: '2024-03-01T08:05:05Z',
    count: 1,
    source: { component: 'default-scheduler' },
  },
];
