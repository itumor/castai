/**
 * Resource service layer.
 *
 * Reads from the K8s client and shapes the raw API objects into the
 * summary types consumed by routes / the frontend. Pure functions — no
 * Express types leak in here.
 */

import type { V1Node, V1Pod, CoreV1Event } from '@kubernetes/client-node';
import type {
  NodePool,
  NodeClaim,
  EC2NodeClass,
  NodePoolSummary,
  NodeClaimSummary,
  EC2NodeClassSummary,
  NodeSummary,
  PodSummary,
  EventSummary,
  PendingPodEvidence,
  SchedulingEvidence,
  CapacityType,
  NodePhase,
  PodPhase,
  TolerationInfo,
  ClusterResourceSummary,
  TopologyResponse,
} from '../../shared/types.js';
import type { K8sClient } from '../k8s/client.js';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const KARPENTER_LABELS = /^karpenter\.sh\//;
const CAPACITY_TYPE_LABEL = 'karpenter.sh/capacity-type';
const NODEPOOL_LABEL = 'karpenter.sh/nodepool';
const NODECLAIM_LABEL = 'karpenter.sh/nodeclaim';

export function ageSeconds(timestamp?: string | null | Date, now = Date.now()): number | undefined {
  if (!timestamp) return undefined;
  const t =
    timestamp instanceof Date
      ? timestamp.getTime()
      : Date.parse(timestamp);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, Math.round((now - t) / 1000));
}

function tsToIso(ts?: Date | string | null): string | undefined {
  if (!ts) return undefined;
  if (ts instanceof Date) return ts.toISOString();
  return ts;
}

function normalisePhase(s: string | undefined): string {
  return (s ?? 'Unknown').trim() || 'Unknown';
}

function nodePhaseFromClaim(status: Record<string, any> | undefined): NodePhase {
  const s = status ?? {};
  const conditions: any[] = Array.isArray(s.conditions) ? s.conditions : [];
  const ready = conditions.find((c) => c?.type === 'Ready');
  const launched = conditions.find((c) => c?.type === 'Launched');
  if (s.phase === 'Deleting') return 'Deleting';
  if (ready?.status === 'True') return 'Running';
  if (launched?.status === 'True') return 'Running';
  return 'Pending';
}

function podPhaseFromStatus(s: any): PodPhase {
  const raw = (s?.phase ?? 'Unknown') as string;
  return raw as PodPhase;
}

function capacityTypeFromLabels(labels?: Record<string, string>): CapacityType {
  const v = labels?.[CAPACITY_TYPE_LABEL]?.toLowerCase();
  if (v === 'spot') return 'spot';
  if (v === 'on-demand') return 'on-demand';
  return 'unknown';
}

function capacityTypeFromNodeClaimSpec(spec: Record<string, any> | undefined): CapacityType {
  // Karpenter NodeClaim stores capacity type under
  // spec.requirements as a `karpenter.sh/capacity-type` requirement.
  const reqs = Array.isArray(spec?.requirements) ? spec!.requirements : [];
  for (const req of reqs) {
    if (req?.key !== CAPACITY_TYPE_LABEL) continue;
    const vals: string[] = Array.isArray(req.values) ? req.values : [];
    if (vals.includes('spot')) return 'spot';
    if (vals.includes('on-demand')) return 'on-demand';
  }
  return 'unknown';
}

function pickOwnerKindName(refs: any[] | undefined): {
  kind?: string;
  name?: string;
} {
  if (!Array.isArray(refs) || refs.length === 0) return {};
  // Prefer controller=true owner refs.
  const controller = refs.find((r) => r?.controller);
  const ref = controller ?? refs[0];
  return { kind: ref?.kind, name: ref?.name };
}

function getAnnotationValue(
  annotations: Record<string, string> | undefined,
  keys: string[],
): string | undefined {
  if (!annotations) return undefined;
  for (const k of keys) {
    if (annotations[k]) return annotations[k];
  }
  return undefined;
}

// -----------------------------------------------------------------------------
// Summary builders
// -----------------------------------------------------------------------------

export function summariseNodePool(np: NodePool): NodePoolSummary {
  const meta = np.metadata ?? ({} as any);
  const spec = np.spec ?? {};
  const status = np.status ?? {};
  return {
    name: meta.name,
    namespace: meta.namespace ?? 'karpenter',
    uid: meta.uid,
    creationTimestamp: meta.creationTimestamp,
    generation: meta.generation,
    weight: typeof spec.weight === 'number' ? spec.weight : undefined,
    limits: spec.limits && typeof spec.limits === 'object' ? spec.limits : undefined,
    conditions: Array.isArray(status.conditions) ? status.conditions : [],
    disruption: spec.disruption && typeof spec.disruption === 'object'
      ? spec.disruption
      : undefined,
    requirements: Array.isArray(spec.template?.spec?.requirements)
      ? spec.template.spec.requirements
      : Array.isArray(spec.requirements)
        ? spec.requirements
        : [],
    nodeClassRef:
      spec.template?.spec?.nodeClassRef ?? spec.nodeClassRef
        ? {
            group: (spec.template?.spec?.nodeClassRef ?? spec.nodeClassRef).group,
            kind: (spec.template?.spec?.nodeClassRef ?? spec.nodeClassRef).kind,
            name: (spec.template?.spec?.nodeClassRef ?? spec.nodeClassRef).name,
          }
        : undefined,
    status,
  };
}

export function summariseNodeClaim(nc: NodeClaim): NodeClaimSummary {
  const meta = nc.metadata ?? ({} as any);
  const spec = nc.spec ?? {};
  const status = nc.status ?? {};
  const labels = meta.labels ?? {};
  const owner = pickOwnerKindName(meta.ownerReferences);
  // Prefer status-derived fields, fall back to spec labels.
  const providerID: string | undefined = status.providerID;
  const instanceType =
    status.instanceType ?? labels['node.kubernetes.io/instance-type'];
  const zone =
    status.zone ??
    labels['topology.kubernetes.io/zone'] ??
    labels['failure-domain.beta.kubernetes.io/zone'];
  const region =
    status.region ?? labels['topology.kubernetes.io/region'];
  const arch =
    status.architecture ??
    labels['kubernetes.io/arch'] ??
    labels['karpenter.k8s.aws/instance-category'];
  const os =
    status.os ?? labels['kubernetes.io/os'];
  return {
    name: meta.name,
    namespace: meta.namespace ?? 'karpenter',
    uid: meta.uid,
    creationTimestamp: meta.creationTimestamp,
    nodePool:
      labels[NODEPOOL_LABEL] ??
      (owner.kind === 'NodePool' ? owner.name : '') ??
      '',
    nodeClass: spec.nodeClassRef?.name ?? labels['karpenter.k8s.aws/ec2nodeclass'],
    nodeName: status.nodeName,
    capacityType:
      capacityTypeFromLabels(labels) === 'unknown'
        ? capacityTypeFromNodeClaimSpec(spec)
        : capacityTypeFromLabels(labels),
    instanceType,
    zone,
    region,
    architecture: arch,
    os,
    capacity:
      status.capacity && typeof status.capacity === 'object' ? status.capacity : undefined,
    allocatable:
      status.allocatable && typeof status.allocatable === 'object'
        ? status.allocatable
        : undefined,
    conditions: Array.isArray(status.conditions) ? status.conditions : [],
    phase: nodePhaseFromClaim(status),
    ageSeconds: ageSeconds(meta.creationTimestamp),
    // keep providerID accessible via status for debugging
    ...(providerID ? { status: { providerID } } : {}),
  };
}

export function summariseEC2NodeClass(enc: EC2NodeClass): EC2NodeClassSummary {
  const meta = enc.metadata ?? ({} as any);
  const spec = enc.spec ?? {};
  const status = enc.status ?? {};
  return {
    name: meta.name,
    namespace: meta.namespace ?? 'karpenter',
    uid: meta.uid,
    creationTimestamp: meta.creationTimestamp,
    amiFamily: spec.amiFamily,
    role: spec.role,
    subnetSelectorTerms: Array.isArray(spec.subnetSelectorTerms)
      ? spec.subnetSelectorTerms.length
      : Array.isArray(spec.subnetSelector?.terms)
        ? spec.subnetSelector.terms.length
        : 0,
    securityGroupSelectorTerms: Array.isArray(spec.securityGroupSelectorTerms)
      ? spec.securityGroupSelectorTerms.length
      : Array.isArray(spec.securityGroupSelector?.terms)
        ? spec.securityGroupSelector.terms.length
        : 0,
    amiSelectorTerms: Array.isArray(spec.amiSelectorTerms)
      ? spec.amiSelectorTerms.length
      : Array.isArray(spec.amiSelector?.terms)
        ? spec.amiSelector.terms.length
        : undefined,
    tags:
      spec.tags && typeof spec.tags === 'object' ? spec.tags : undefined,
    blockDeviceMappings: Array.isArray(spec.blockDeviceMappings)
      ? spec.blockDeviceMappings.length
      : undefined,
    status,
  };
}

export function summariseNode(node: V1Node): NodeSummary {
  const meta = node.metadata ?? ({} as any);
  const labels = meta.labels ?? {};
  return {
    name: meta.name ?? '',
    uid: meta.uid,
    creationTimestamp: tsToIso(meta.creationTimestamp),
    instanceType: labels['node.kubernetes.io/instance-type'],
    zone:
      labels['topology.kubernetes.io/zone'] ??
      labels['failure-domain.beta.kubernetes.io/zone'],
    region: labels['topology.kubernetes.io/region'],
    architecture: labels['kubernetes.io/arch'],
    os: labels['kubernetes.io/os'],
    capacityType: capacityTypeFromLabels(labels),
    nodeClaim: labels[NODECLAIM_LABEL],
    nodePool: labels[NODEPOOL_LABEL],
    ready: nodeIsReady(node),
    schedulable: node.spec?.unschedulable !== true,
    cpuCapacity: node.status?.capacity?.cpu,
    memoryCapacity: node.status?.capacity?.memory,
    podCapacity: node.status?.capacity?.pods,
    conditions: node.status?.conditions ?? [],
    ageSeconds: ageSeconds(meta.creationTimestamp),
    labels,
  };
}

function nodeIsReady(node: V1Node): boolean {
  const conds = node.status?.conditions ?? [];
  const ready = conds.find((c) => c?.type === 'Ready');
  return ready?.status === 'True';
}

export function summarisePod(pod: V1Pod): PodSummary {
  const meta = pod.metadata ?? ({} as any);
  const labels = meta.labels ?? {};
  const owner = pickOwnerKindName(meta.ownerReferences);
  return {
    name: meta.name ?? '',
    namespace: meta.namespace ?? 'default',
    uid: meta.uid,
    creationTimestamp: tsToIso(meta.creationTimestamp),
    nodeName: pod.spec?.nodeName,
    phase: podPhaseFromStatus(pod.status),
    ageSeconds: ageSeconds(meta.creationTimestamp),
    ownerKind: owner.kind,
    ownerName: owner.name,
    nodePool: labels[NODEPOOL_LABEL],
    labels,
  };
}

export function summariseEvent(event: CoreV1Event): EventSummary {
  const meta = event.metadata ?? ({} as any);
  const involved = event.involvedObject ?? {};
  const ts = event.lastTimestamp ?? event.firstTimestamp ?? event.eventTime;
  return {
    type: (event.type as 'Normal' | 'Warning') ?? 'Normal',
    reason: event.reason ?? '',
    message: event.message ?? '',
    involvedObject: {
      kind: involved.kind ?? '',
      namespace: involved.namespace,
      name: involved.name ?? '',
      uid: involved.uid,
    },
    namespace: meta.namespace ?? involved.namespace ?? 'default',
    firstTimestamp: tsToIso(event.firstTimestamp),
    lastTimestamp: tsToIso(event.lastTimestamp),
    eventTime: typeof event.eventTime === 'string' ? event.eventTime : undefined,
    ageSeconds: ageSeconds(ts as any),
    source: event.source?.component,
    count: typeof event.count === 'number' ? event.count : undefined,
  };
}

// -----------------------------------------------------------------------------
// Pending pod evidence extraction
// -----------------------------------------------------------------------------

export function extractSchedulingEvidence(pod: V1Pod): SchedulingEvidence {
  const spec = pod.spec ?? ({} as any);
  const labels = pod.metadata?.labels ?? {};
  const containers: any[] = Array.isArray(spec.containers) ? spec.containers : [];
  const initContainers: any[] = Array.isArray(spec.initContainers)
    ? spec.initContainers
    : [];
  const allContainers = [...containers, ...initContainers];

  const requests: Record<string, string> = {};
  for (const c of allContainers) {
    const res = c?.resources?.requests ?? {};
    for (const [k, v] of Object.entries(res)) {
      if (typeof v === 'string') {
        // Sum if both are numeric quantities; otherwise prefer the first seen.
        const existing = requests[k];
        if (existing && isQuantity(existing) && isQuantity(v)) {
          requests[k] = sumQuantities(existing, v);
        } else if (!existing) {
          requests[k] = v;
        }
      }
    }
  }

  const nodeSelector: Record<string, string> = {};
  for (const [k, v] of Object.entries(spec.nodeSelector ?? {})) {
    if (typeof v === 'string') nodeSelector[k] = v;
  }

  const affinity = spec.affinity ?? null;
  const topologySpreadConstraints: any[] = Array.isArray(
    spec.topologySpreadConstraints,
  )
    ? spec.topologySpreadConstraints
    : [];

  const tolerations: TolerationInfo[] = (spec.tolerations ?? []).map(
    (t: any) => ({
      key: t?.key,
      operator: t?.operator ?? 'Equal',
      value: t?.value,
      effect: t?.effect,
      tolerationSeconds: t?.tolerationSeconds,
    }),
  );

  const architecture = extractArchitecture(affinity, labels, spec.nodeSelector);

  const zonePreference = extractZonePreference(affinity, nodeSelector, labels);
  const instanceTypePreference = extractInstanceTypePreference(
    affinity,
    nodeSelector,
    labels,
  );
  const capacityTypePreference = extractCapacityTypePreference(
    affinity,
    nodeSelector,
    labels,
  );

  const karpenterLabels: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) {
    if (KARPENTER_LABELS.test(k)) karpenterLabels[k] = v;
  }

  const reasons = buildReasons({
    phase: pod.status?.phase,
    conditions: pod.status?.conditions,
    hasNode: !!pod.spec?.nodeName,
    requests,
    nodeSelector,
    affinity,
    tolerations,
    topologySpreadConstraints,
    karpenterLabels,
  });

  return {
    requests,
    nodeSelector,
    affinity: affinity
      ? {
          nodeAffinity: affinity.nodeAffinity,
          podAffinity: affinity.podAffinity,
          podAntiAffinity: affinity.podAntiAffinity,
        }
      : null,
    topologySpreadConstraints,
    tolerations,
    runtimeClassName: spec.runtimeClassName,
    architecture,
    zonePreference,
    instanceTypePreference,
    capacityTypePreference,
    karpenterLabels,
    reasons,
  };
}

function isQuantity(s: string): boolean {
  // A quantity is e.g. "100m", "1Gi", "0.5". Anything else we keep verbatim.
  return /^[0-9]+(\.[0-9]+)?(m|K|M|G|T|P|E|k|n|u)?$/.test(s);
}

function sumQuantities(a: string, b: string): string {
  const parse = (s: string): number => {
    if (s.endsWith('m')) return parseFloat(s.slice(0, -1)) / 1000;
    if (s.endsWith('k')) return parseFloat(s.slice(0, -1)) * 1000;
    return parseFloat(s);
  };
  const sum = parse(a) + parse(b);
  if (a.endsWith('m')) return `${Math.round(sum * 1000)}m`;
  if (a.endsWith('k')) return `${sum}k`;
  return `${sum}`;
}

function extractArchitecture(
  affinity: any,
  labels: Record<string, string>,
  nodeSelector: Record<string, string>,
): string | undefined {
  const direct = labels['kubernetes.io/arch'];
  if (direct) return direct;
  const fromSelector = nodeSelector['kubernetes.io/arch'];
  if (fromSelector) return fromSelector;
  const terms: any[] =
    affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution
      ?.nodeSelectorTerms ?? [];
  for (const term of terms) {
    for (const expr of term.matchExpressions ?? []) {
      if (expr?.key === 'kubernetes.io/arch') {
        return Array.isArray(expr.values) ? expr.values.join(',') : undefined;
      }
    }
  }
  return undefined;
}

function extractZonePreference(
  affinity: any,
  nodeSelector: Record<string, string>,
  labels: Record<string, string>,
): string[] | undefined {
  const out = new Set<string>();
  const ns = nodeSelector['topology.kubernetes.io/zone'];
  if (ns) out.add(ns);
  const terms: any[] =
    affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution
      ?.nodeSelectorTerms ?? [];
  for (const term of terms) {
    for (const expr of term.matchExpressions ?? []) {
      if (expr?.key === 'topology.kubernetes.io/zone' && expr.operator === 'In') {
        for (const v of expr.values ?? []) out.add(v);
      }
    }
  }
  if (out.size === 0) return undefined;
  return Array.from(out);
}

function extractInstanceTypePreference(
  affinity: any,
  nodeSelector: Record<string, string>,
  _labels: Record<string, string>,
): string[] | undefined {
  const out = new Set<string>();
  const ns = nodeSelector['node.kubernetes.io/instance-type'];
  if (ns) out.add(ns);
  const terms: any[] =
    affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution
      ?.nodeSelectorTerms ?? [];
  for (const term of terms) {
    for (const expr of term.matchExpressions ?? []) {
      if (
        expr?.key === 'node.kubernetes.io/instance-type' &&
        expr.operator === 'In'
      ) {
        for (const v of expr.values ?? []) out.add(v);
      }
    }
  }
  if (out.size === 0) return undefined;
  return Array.from(out);
}

function extractCapacityTypePreference(
  affinity: any,
  nodeSelector: Record<string, string>,
  labels: Record<string, string>,
): string[] | undefined {
  const out = new Set<string>();
  const ns = nodeSelector[CAPACITY_TYPE_LABEL];
  if (ns) out.add(ns);
  const fromLabel = labels[CAPACITY_TYPE_LABEL];
  if (fromLabel) out.add(fromLabel);
  const terms: any[] =
    affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution
      ?.nodeSelectorTerms ?? [];
  for (const term of terms) {
    for (const expr of term.matchExpressions ?? []) {
      if (expr?.key === CAPACITY_TYPE_LABEL && expr.operator === 'In') {
        for (const v of expr.values ?? []) out.add(v);
      }
    }
  }
  if (out.size === 0) return undefined;
  return Array.from(out);
}

function buildReasons(input: {
  phase?: string;
  conditions?: any[];
  hasNode: boolean;
  requests: Record<string, string>;
  nodeSelector: Record<string, string>;
  affinity: any;
  tolerations: TolerationInfo[];
  topologySpreadConstraints: any[];
  karpenterLabels: Record<string, string>;
}): string[] {
  const reasons: string[] = [];
  if (input.phase === 'Pending' && !input.hasNode) {
    reasons.push('pod is unscheduled');
  }
  const cs = Array.isArray(input.conditions) ? input.conditions : [];
  for (const c of cs) {
    if (c?.status === 'True' && c?.reason) {
      reasons.push(`${c.reason}: ${c.message ?? ''}`.trim());
    }
  }
  if (Object.keys(input.requests).length === 0) {
    reasons.push('no resource requests set');
  }
  if (Object.keys(input.nodeSelector).length > 0) {
    reasons.push(`nodeSelector: ${Object.keys(input.nodeSelector).join(', ')}`);
  }
  if (input.affinity) {
    if (input.affinity.nodeAffinity)
      reasons.push('has nodeAffinity constraints');
    if (input.affinity.podAffinity)
      reasons.push('has podAffinity constraints');
    if (input.affinity.podAntiAffinity)
      reasons.push('has podAntiAffinity constraints');
  }
  if (input.topologySpreadConstraints.length > 0) {
    reasons.push(
      `${input.topologySpreadConstraints.length} topologySpreadConstraint(s)`,
    );
  }
  if (input.tolerations.length > 0) {
    reasons.push(`${input.tolerations.length} toleration(s)`);
  }
  if (Object.keys(input.karpenterLabels).length > 0) {
    reasons.push(
      `karpenter labels: ${Object.keys(input.karpenterLabels).join(', ')}`,
    );
  }
  return reasons;
}

// -----------------------------------------------------------------------------
// Aggregation helpers
// -----------------------------------------------------------------------------

export interface FetchAllOptions {
  client: K8sClient;
  namespace?: string;
}

export async function fetchAllNodePools(
  opts: FetchAllOptions,
): Promise<NodePoolSummary[]> {
  const items = await opts.client.listNodePools(opts.namespace);
  return items.map(summariseNodePool);
}

export async function fetchAllNodeClaims(
  opts: FetchAllOptions,
): Promise<NodeClaimSummary[]> {
  const items = await opts.client.listNodeClaims(opts.namespace);
  return items.map(summariseNodeClaim);
}

export async function fetchAllEC2NodeClasses(
  opts: FetchAllOptions,
): Promise<EC2NodeClassSummary[]> {
  const items = await opts.client.listEC2NodeClasses(opts.namespace);
  return items.map(summariseEC2NodeClass);
}

export async function fetchAllNodes(client: K8sClient): Promise<NodeSummary[]> {
  const items = await client.listNodes();
  return items.map(summariseNode);
}

export async function fetchAllPods(
  client: K8sClient,
  namespace?: string,
): Promise<PodSummary[]> {
  const items = await client.listPods(namespace);
  return items.map(summarisePod);
}

export async function fetchAllEvents(
  client: K8sClient,
  namespace?: string,
): Promise<CoreV1Event[]> {
  return client.listEvents(namespace);
}

// -----------------------------------------------------------------------------
// Event filtering (Karpenter-focused)
// -----------------------------------------------------------------------------

const EVENT_KINDS_OF_INTEREST = new Set([
  'NodeClaim',
  'NodePool',
  'EC2NodeClass',
  'Node',
  'Pod',
]);

export async function fetchFilteredEvents(
  client: K8sClient,
): Promise<EventSummary[]> {
  // Best-effort: if `karpenter` namespace exists, fetch its events plus all
  // cluster-wide events whose involvedObject is one of the Karpenter /
  // schedulable kinds. Otherwise return all events (cluster-wide).
  let karpenterEvents: CoreV1Event[] = [];
  try {
    if (await client.hasKarpenterNamespace()) {
      karpenterEvents = await client.listEvents('karpenter');
    }
  } catch {
    karpenterEvents = [];
  }
  let allEvents: CoreV1Event[] = [];
  try {
    allEvents = await client.listEvents();
  } catch {
    allEvents = [];
  }

  const seen = new Set<string>();
  const out: EventSummary[] = [];
  const include = (e: CoreV1Event) => {
    const key = `${e.metadata?.uid ?? e.metadata?.name ?? Math.random()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const kind = e.involvedObject?.kind;
    if (kind && EVENT_KINDS_OF_INTEREST.has(kind)) {
      out.push(summariseEvent(e));
      return;
    }
    if (e.involvedObject?.namespace === 'karpenter') {
      out.push(summariseEvent(e));
    }
  };

  for (const e of allEvents) include(e);
  for (const e of karpenterEvents) include(e);
  // Sort by lastTimestamp desc when available.
  out.sort((a, b) => {
    const ta = Date.parse(a.lastTimestamp ?? a.eventTime ?? '') || 0;
    const tb = Date.parse(b.lastTimestamp ?? b.eventTime ?? '') || 0;
    return tb - ta;
  });
  return out;
}

// -----------------------------------------------------------------------------
// Pending pod extraction
// -----------------------------------------------------------------------------

export async function fetchPendingPods(
  client: K8sClient,
): Promise<PendingPodEvidence[]> {
  const pods = await client.listPods();
  const out: PendingPodEvidence[] = [];
  for (const pod of pods) {
    if (pod.status?.phase !== 'Pending') continue;
    out.push({
      pod: summarisePod(pod),
      evidence: extractSchedulingEvidence(pod),
    });
  }
  return out;
}

// -----------------------------------------------------------------------------
// Topology assembly
// -----------------------------------------------------------------------------

export async function buildTopology(client: K8sClient): Promise<TopologyResponse> {
  const [nodePools, nodeClaims, ec2NodeClasses, nodes, pods, pendingPods, events] =
    await Promise.all([
      fetchAllNodePools({ client }),
      fetchAllNodeClaims({ client }),
      fetchAllEC2NodeClasses({ client }),
      fetchAllNodes(client),
      fetchAllPods(client),
      fetchPendingPods(client),
      fetchFilteredEvents(client),
    ]);

  // Enrich NodeSummaries with nodePool relationship if not yet present.
  const claimByName = new Map(nodeClaims.map((c) => [c.name, c]));
  const enrichedNodes: NodeSummary[] = nodes.map((n) => {
    const claimName = n.nodeClaim;
    const claim = claimName ? claimByName.get(claimName) : undefined;
    return {
      ...n,
      nodePool: n.nodePool ?? claim?.nodePool,
    };
  });

  const cluster = buildClusterSummary({
    nodePools,
    nodeClaims,
    ec2NodeClasses,
    nodes: enrichedNodes,
    pendingPods,
    events,
  });

  return {
    nodePools,
    nodeClaims,
    ec2NodeClasses,
    nodes: enrichedNodes,
    pods,
    pendingPods,
    events,
    cluster,
    generatedAt: new Date().toISOString(),
  };
}

function buildClusterSummary(input: {
  nodePools: NodePoolSummary[];
  nodeClaims: NodeClaimSummary[];
  ec2NodeClasses: EC2NodeClassSummary[];
  nodes: NodeSummary[];
  pendingPods: PendingPodEvidence[];
  events: EventSummary[];
}): ClusterResourceSummary {
  const spotCount = input.nodes.filter((n) => n.capacityType === 'spot').length;
  const onDemandCount = input.nodes.filter((n) => n.capacityType === 'on-demand').length;
  let totalCpuMillis = 0;
  let totalMemoryBytes = 0;
  for (const n of input.nodes) {
    if (n.cpuCapacity) totalCpuMillis += parseCpu(n.cpuCapacity);
    if (n.memoryCapacity) totalMemoryBytes += parseMemory(n.memoryCapacity);
  }
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  const recentEventCount = input.events.filter((e) => {
    const ts = Date.parse(e.lastTimestamp ?? e.eventTime ?? '');
    return Number.isFinite(ts) && ts >= tenMinutesAgo;
  }).length;
  return {
    nodePoolCount: input.nodePools.length,
    nodeClaimCount: input.nodeClaims.length,
    ec2NodeClassCount: input.ec2NodeClasses.length,
    nodeCount: input.nodes.length,
    readyNodeCount: input.nodes.filter((n) => n.ready).length,
    pendingPodCount: input.pendingPods.length,
    spotCount,
    onDemandCount,
    totalCpu: formatCpu(totalCpuMillis),
    totalMemory: formatMemory(totalMemoryBytes),
    recentEventCount,
  };
}

function parseCpu(q: string): number {
  if (q.endsWith('m')) return parseFloat(q.slice(0, -1));
  return parseFloat(q) * 1000;
}

function formatCpu(millis: number): string {
  if (millis >= 1000) return `${(millis / 1000).toFixed(2)}`;
  return `${millis}m`;
}

function parseMemory(q: string): number {
  const m: Record<string, number> = {
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
    P: 1024 ** 5,
    E: 1024 ** 6,
  };
  const match = /^([0-9.]+)([KMGTPE]?i?)$/.exec(q);
  if (!match) return 0;
  const [, num, suffix] = match;
  const base = suffix.endsWith('i') ? 1024 : 1000;
  const power =
    {
      '': 1,
      K: base,
      M: base ** 2,
      G: base ** 3,
      T: base ** 4,
      P: base ** 5,
      E: base ** 6,
    }[suffix.replace(/i$/, '')] ?? 1;
  return parseFloat(num) * power;
}

function formatMemory(bytes: number): string {
  if (bytes <= 0) return '0';
  const units = ['B', 'Ki', 'Mi', 'Gi', 'Ti', 'Pi'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 2)}${units[i]}`;
}
