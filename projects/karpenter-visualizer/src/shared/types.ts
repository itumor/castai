// Shared types for the Karpenter Visualizer backend and frontend.
// Keep this file framework-agnostic (no Node-only or DOM-only types).

// -----------------------------------------------------------------------------
// Health
// -----------------------------------------------------------------------------

export interface HealthResponse {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

// -----------------------------------------------------------------------------
// Capacity / phase enums
// -----------------------------------------------------------------------------

export type CapacityType = 'spot' | 'on-demand' | 'unknown';

export type NodePhase =
  | 'Pending'
  | 'Running'
  | 'Deleting'
  | 'Unknown';

export type PodPhase =
  | 'Pending'
  | 'Running'
  | 'Succeeded'
  | 'Failed'
  | 'Unknown';

// -----------------------------------------------------------------------------
// Karpenter raw types
// -----------------------------------------------------------------------------
// Karpenter CRD bodies are loosely typed (spec/status left as Record<string, any>)
// so the visualizer can adapt across minor schema drift without recompiling.

export interface NodePool {
  apiVersion?: string;
  kind?: string;
  metadata: {
    name: string;
    namespace?: string;
    uid?: string;
    creationTimestamp?: string;
    generation?: number;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: Record<string, any>;
  status?: Record<string, any>;
}

export interface NodeClaim {
  apiVersion?: string;
  kind?: string;
  metadata: {
    name: string;
    namespace?: string;
    uid?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: Array<{
      apiVersion?: string;
      kind?: string;
      name: string;
      uid?: string;
      controller?: boolean;
    }>;
  };
  spec?: Record<string, any>;
  status?: Record<string, any>;
}

export interface EC2NodeClass {
  apiVersion?: string;
  kind?: string;
  metadata: {
    name: string;
    namespace?: string;
    uid?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: Record<string, any>;
  status?: Record<string, any>;
}

// -----------------------------------------------------------------------------
// Summary types — what the API returns and the UI consumes
// -----------------------------------------------------------------------------

export interface NodePoolSummary {
  name: string;
  namespace: string;
  uid?: string;
  creationTimestamp?: string;
  generation?: number;
  weight?: number;
  limits?: Record<string, string | number>;
  conditions?: any[];
  disruption?: Record<string, any>;
  requirements?: any[];
  nodeClassRef?: { group: string; kind: string; name: string };
  status?: Record<string, any>;
}

export interface NodeClaimSummary {
  name: string;
  namespace: string;
  uid?: string;
  creationTimestamp?: string;
  nodePool: string;
  nodeClass?: string;
  nodeName?: string;
  capacityType: CapacityType;
  instanceType?: string;
  zone?: string;
  region?: string;
  architecture?: string;
  os?: string;
  capacity?: Record<string, string>;
  allocatable?: Record<string, string>;
  conditions?: any[];
  phase?: NodePhase;
  ageSeconds?: number;
}

export interface EC2NodeClassSummary {
  name: string;
  namespace: string;
  uid?: string;
  creationTimestamp?: string;
  amiFamily?: string;
  role?: string;
  subnetSelectorTerms: number;
  securityGroupSelectorTerms: number;
  amiSelectorTerms?: number;
  tags?: Record<string, string>;
  blockDeviceMappings?: number;
  status?: Record<string, any>;
}

export interface NodeSummary {
  name: string;
  uid?: string;
  creationTimestamp?: string;
  instanceType?: string;
  zone?: string;
  region?: string;
  architecture?: string;
  os?: string;
  capacityType: CapacityType;
  nodeClaim?: string;
  nodePool?: string;
  ready: boolean;
  schedulable?: boolean;
  cpuCapacity?: string;
  memoryCapacity?: string;
  podCapacity?: string;
  conditions?: any[];
  ageSeconds?: number;
  labels?: Record<string, string>;
}

export interface PodSummary {
  name: string;
  namespace: string;
  uid?: string;
  creationTimestamp?: string;
  nodeName?: string;
  phase: PodPhase;
  ageSeconds?: number;
  ownerKind?: string;
  ownerName?: string;
  nodePool?: string;
  labels?: Record<string, string>;
}

export interface EventSummary {
  type: 'Normal' | 'Warning';
  reason: string;
  message: string;
  involvedObject: {
    kind: string;
    namespace?: string;
    name: string;
    uid?: string;
  };
  namespace: string;
  firstTimestamp?: string;
  lastTimestamp?: string;
  eventTime?: string;
  ageSeconds?: number;
  source?: string;
  count?: number;
}

// -----------------------------------------------------------------------------
// Pending pod scheduling evidence
// -----------------------------------------------------------------------------

export interface ResourceQuantities {
  cpu?: string;
  memory?: string;
  'ephemeral-storage'?: string;
  [resource: string]: string | undefined;
}

export interface TolerationInfo {
  key?: string;
  operator?: string;
  value?: string;
  effect?: string;
  tolerationSeconds?: number;
}

export interface SchedulingEvidence {
  requests: ResourceQuantities;
  nodeSelector: Record<string, string>;
  affinity: {
    nodeAffinity?: any;
    podAffinity?: any;
    podAntiAffinity?: any;
  } | null;
  topologySpreadConstraints: any[];
  tolerations: TolerationInfo[];
  runtimeClassName?: string;
  architecture?: string;
  zonePreference?: string[];
  instanceTypePreference?: string[];
  capacityTypePreference?: string[];
  karpenterLabels: Record<string, string>;
  karpenterRequirements?: any[];
  reasons: string[];
}

export interface PendingPodEvidence {
  pod: PodSummary;
  evidence: SchedulingEvidence;
}

export interface PendingPodResponse {
  items: PendingPodEvidence[];
  totalCount: number;
  generatedAt: string;
}

// -----------------------------------------------------------------------------
// Topology
// -----------------------------------------------------------------------------

export interface ClusterResourceSummary {
  nodePoolCount: number;
  nodeClaimCount: number;
  ec2NodeClassCount: number;
  nodeCount: number;
  readyNodeCount: number;
  pendingPodCount: number;
  spotCount: number;
  onDemandCount: number;
  totalCpu: string;
  totalMemory: string;
  recentEventCount: number;
}

export interface TopologyResponse {
  nodePools: NodePoolSummary[];
  nodeClaims: NodeClaimSummary[];
  ec2NodeClasses: EC2NodeClassSummary[];
  nodes: NodeSummary[];
  pods: PodSummary[];
  pendingPods: PendingPodEvidence[];
  events: EventSummary[];
  cluster: ClusterResourceSummary;
  generatedAt: string;
}
