/**
 * Read-only Kubernetes client wrapper.
 *
 * READ-ONLY GUARANTEE
 * -------------------
 * This module and its consumers MUST NOT issue create / update / patch /
 * delete operations against the Kubernetes API. Only the following verbs
 * are permitted: get, list, watch. The accompanying RBAC manifest under
 * `k8s/rbac.yaml` enforces the same constraint at the cluster level.
 *
 * Usage:
 *   const { getK8sClient } = await import('./k8s/client.js');
 *   const client = await getK8sClient();
 *   const nodes = await client.listNodes();
 *
 * When the env var MOCK_K8S=true is set, an in-memory client that returns
 * empty arrays is returned instead. This keeps tests and local development
 * working without a real cluster.
 */

import {
  KubeConfig,
  CoreV1Api,
  CustomObjectsApi,
} from '@kubernetes/client-node';
import type {
  NodePool,
  NodeClaim,
  EC2NodeClass,
} from '../../shared/types.js';
import type { V1Node, V1Pod, CoreV1Event } from '@kubernetes/client-node';

const MOCK_FLAG = 'MOCK_K8S';

// -----------------------------------------------------------------------------
// Client interface — both real and mock implementations satisfy this shape.
// -----------------------------------------------------------------------------

export interface K8sClient {
  /** Indicates the client is backed by a real cluster connection. */
  readonly real: boolean;

  // Core resources
  listNodes(): Promise<V1Node[]>;
  listPods(namespace?: string): Promise<V1Pod[]>;
  listEvents(namespace?: string): Promise<CoreV1Event[]>;

  // Karpenter CRDs
  listNodePools(namespace?: string): Promise<NodePool[]>;
  listNodeClaims(namespace?: string): Promise<NodeClaim[]>;
  listEC2NodeClasses(namespace?: string): Promise<EC2NodeClass[]>;

  /**
   * Best-effort probe to check whether the `karpenter` namespace exists.
   * Real client lists namespaces and filters; mock returns false.
   */
  hasKarpenterNamespace(): Promise<boolean>;
}

// -----------------------------------------------------------------------------
// Real implementation
// -----------------------------------------------------------------------------

const NODEPOOL_PLURAL = 'nodepools';
const NODECLAIM_PLURAL = 'nodeclaims';
const EC2NODECLASS_PLURAL = 'ec2nodeclasses';

const NODEPOOL_API = 'karpenter.sh';
const NODEPOOL_VERSION = 'v1';
const EC2NODECLASS_API = 'karpenter.k8s.aws';
const EC2NODECLASS_VERSION = 'v1';

interface RealK8sClient extends K8sClient {
  readonly real: true;
  readonly core: CoreV1Api;
  readonly custom: CustomObjectsApi;
}

function buildKubeConfig(): KubeConfig {
  const kc = new KubeConfig();
  // Try in-cluster first (service account mounted at /var/run/secrets/...).
  // Fall back to default kubeconfig location for local development.
  let loaded = false;
  try {
    kc.loadFromCluster();
    loaded = !!kc.getCurrentCluster();
  } catch {
    loaded = false;
  }
  if (!loaded) {
    try {
      kc.loadFromDefault();
    } catch {
      // Re-throw on first real use via `getK8sClient`.
      throw new Error(
        'no Kubernetes cluster context available (in-cluster and kubeconfig both failed)',
      );
    }
  }
  if (!kc.getCurrentCluster()) {
    throw new Error('no Kubernetes cluster context available');
  }
  return kc;
}

async function createRealClient(): Promise<RealK8sClient> {
  const kc = buildKubeConfig();
  const core = kc.makeApiClient(CoreV1Api);
  const custom = kc.makeApiClient(CustomObjectsApi);

  const client: RealK8sClient = {
    real: true,
    core,
    custom,

    async listNodes() {
      const res = await core.listNode();
      return res.body.items ?? [];
    },

    async listPods(namespace) {
      const res = namespace
        ? await core.listNamespacedPod(namespace)
        : await core.listPodForAllNamespaces();
      return res.body.items ?? [];
    },

    async listEvents(namespace) {
      const res = namespace
        ? await core.listNamespacedEvent(namespace)
        : await core.listEventForAllNamespaces();
      return res.body.items ?? [];
    },

    async listNodePools(namespace) {
      const res = (await (namespace
        ? custom.listNamespacedCustomObject(
            NODEPOOL_API,
            NODEPOOL_VERSION,
            namespace,
            NODEPOOL_PLURAL,
          )
        : custom.listClusterCustomObject(
            NODEPOOL_API,
            NODEPOOL_VERSION,
            NODEPOOL_PLURAL,
          ))) as { items?: NodePool[] };
      return res.items ?? [];
    },

    async listNodeClaims(namespace) {
      const res = (await (namespace
        ? custom.listNamespacedCustomObject(
            NODEPOOL_API,
            NODEPOOL_VERSION,
            namespace,
            NODECLAIM_PLURAL,
          )
        : custom.listClusterCustomObject(
            NODEPOOL_API,
            NODEPOOL_VERSION,
            NODECLAIM_PLURAL,
          ))) as { items?: NodeClaim[] };
      return res.items ?? [];
    },

    async listEC2NodeClasses(namespace) {
      const res = (await (namespace
        ? custom.listNamespacedCustomObject(
            EC2NODECLASS_API,
            EC2NODECLASS_VERSION,
            namespace,
            EC2NODECLASS_PLURAL,
          )
        : custom.listClusterCustomObject(
            EC2NODECLASS_API,
            EC2NODECLASS_VERSION,
            EC2NODECLASS_PLURAL,
          ))) as { items?: EC2NodeClass[] };
      return res.items ?? [];
    },

    async hasKarpenterNamespace() {
      try {
        const res = await core.listNamespace();
        return (res.body.items ?? []).some(
          (ns: { metadata?: { name?: string } }) => ns.metadata?.name === 'karpenter',
        );
      } catch {
        return false;
      }
    },
  };

  return client;
}

// -----------------------------------------------------------------------------
// Mock implementation
// -----------------------------------------------------------------------------

interface MockK8sClient extends K8sClient {
  readonly real: false;
}

function createMockClient(): MockK8sClient {
  // When MOCK_K8S=true, return a fixture-driven client. The fixture
  // data is supplied via `setMockClusterData` (typically called from
  // test setup); when not set, the client returns empty arrays.
  const listAll = <T>(
    kind: 'nodePools' | 'nodeClaims' | 'ec2NodeClasses' | 'nodes' | 'pods' | 'events',
    namespace?: string,
  ): T[] => {
    const arr = (mockClusterData?.[kind] as T[] | undefined) ?? [];
    if (!namespace) return [...arr];
    return arr.filter((item: any) => {
      const ns =
        item?.metadata?.namespace ??
        item?.involvedObject?.namespace ??
        item?.namespace;
      return ns === namespace;
    });
  };

  return {
    real: false,
    async listNodes() {
      return listAll<V1Node>('nodes');
    },
    async listPods(namespace?: string) {
      return listAll<V1Pod>('pods', namespace);
    },
    async listEvents(namespace?: string) {
      return listAll<CoreV1Event>('events', namespace);
    },
    async listNodePools(namespace?: string) {
      return listAll<NodePool>('nodePools', namespace);
    },
    async listNodeClaims(namespace?: string) {
      return listAll<NodeClaim>('nodeClaims', namespace);
    },
    async listEC2NodeClasses(namespace?: string) {
      return listAll<EC2NodeClass>('ec2NodeClasses', namespace);
    },
    async hasKarpenterNamespace() {
      // Mock cluster always has a `karpenter` namespace.
      return true;
    },
  };
}

// -----------------------------------------------------------------------------
// Mock cluster data injection
// -----------------------------------------------------------------------------

export interface MockClusterData {
  nodePools: NodePool[];
  nodeClaims: NodeClaim[];
  ec2NodeClasses: EC2NodeClass[];
  nodes: V1Node[];
  pods: V1Pod[];
  events: CoreV1Event[];
}

let mockClusterData: MockClusterData | undefined;

export function setMockClusterData(data: MockClusterData | undefined): void {
  mockClusterData = data;
}

export function getMockClusterData(): MockClusterData | undefined {
  return mockClusterData;
}

// -----------------------------------------------------------------------------
// Singleton accessor
// -----------------------------------------------------------------------------

let cached: Promise<K8sClient> | undefined;

export function isMockMode(): boolean {
  const raw = process.env[MOCK_FLAG];
  if (!raw) return false;
  const lower = raw.trim().toLowerCase();
  return lower === '1' || lower === 'true' || lower === 'yes';
}

export function resetK8sClient(): void {
  cached = undefined;
}

/**
 * Lazily construct (or return the cached) Kubernetes client.
 * When MOCK_K8S=true, returns an in-memory client with empty results.
 */
export async function getK8sClient(): Promise<K8sClient> {
  if (!cached) {
    cached = (async () => {
      if (isMockMode()) {
        return createMockClient();
      }
      return createRealClient();
    })();
  }
  return cached;
}
