/**
 * EC2NodeClass fixtures.
 *
 * One realistic EC2NodeClass used by both NodePools in this mock cluster.
 * The structure follows `karpenter.k8s.aws/v1` EC2NodeClass schema so that
 * `summariseEC2NodeClass` can extract subnet/securityGroup/AMI selectors.
 */

import type { EC2NodeClass } from '../../src/shared/types.js';

export const DEFAULT_EC2NODECLASS_NAME = 'default';
export const DEFAULT_EC2NODECLASS_UID = 'ec2nodeclass-uid-default-0001';

export const ec2NodeClassFixtures: EC2NodeClass[] = [
  {
    apiVersion: 'karpenter.k8s.aws/v1beta1',
    kind: 'EC2NodeClass',
    metadata: {
      name: DEFAULT_EC2NODECLASS_NAME,
      namespace: 'karpenter',
      uid: DEFAULT_EC2NODECLASS_UID,
      creationTimestamp: '2024-01-15T12:00:00Z',
      generation: 1,
      labels: {
        'app.kubernetes.io/managed-by': 'karpenter-visualizer-fixtures',
      },
      annotations: {
        'karpenter.k8s.aws/some-annotation': 'fixture-value',
      },
    },
    spec: {
      amiFamily: 'AL2',
      role: 'KarpenterNodeRole-prod',
      subnetSelectorTerms: [
        { tags: { Name: 'prod-vpc-private-us-east-1a' } },
        { tags: { Name: 'prod-vpc-private-us-east-1b' } },
      ],
      securityGroupSelectorTerms: [
        { tags: { Name: 'karpenter-sg-prod' } },
      ],
      amiSelectorTerms: [
        { alias: 'al2023@v20240807' },
      ],
      blockDeviceMappings: [
        {
          deviceName: '/dev/xvda',
          ebs: {
            volumeSize: '100Gi',
            volumeType: 'gp3',
            deleteOnTermination: true,
          },
        },
      ],
      tags: {
        'karpenter.sh/discovery': 'prod-cluster',
        environment: 'production',
      },
    },
    status: {
      conditions: [
        {
          type: 'Ready',
          status: 'True',
          lastTransitionTime: '2024-01-15T12:01:00Z',
          reason: 'ReconciliationSucceeded',
          message: 'EC2NodeClass reconciled',
        },
      ],
    },
  },
];

export function getEC2NodeClassByName(name: string): EC2NodeClass | undefined {
  return ec2NodeClassFixtures.find((n) => n.metadata.name === name);
}
