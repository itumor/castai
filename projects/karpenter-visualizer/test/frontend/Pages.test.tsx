import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { BrowserRouter } from 'react-router-dom';
import NodePools from '../../src/frontend/pages/NodePools';
import NodeClaims from '../../src/frontend/pages/NodeClaims';
import Nodes from '../../src/frontend/pages/Nodes';
import PendingPods from '../../src/frontend/pages/PendingPods';
import Events from '../../src/frontend/pages/Events';
import type {
  EC2NodeClassSummary,
  EventSummary,
  NodeClaimSummary,
  NodePoolSummary,
  NodeSummary,
  PendingPodEvidence,
  PendingPodResponse,
} from '../../src/shared/types';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const nodePools: NodePoolSummary[] = [
  {
    name: 'default',
    namespace: 'karpenter',
    uid: 'np-default-uid',
    creationTimestamp: '2024-03-01T10:00:00Z',
    weight: 10,
    limits: { cpu: '200', memory: '800Gi' },
    nodeClassRef: { group: 'karpenter.k8s.aws', kind: 'EC2NodeClass', name: 'default' },
    requirements: [
      { key: 'karpenter.sh/capacity-type', operator: 'In', values: ['on-demand', 'spot'] },
    ],
    status: { conditions: [{ type: 'Ready', status: 'True' }] },
  },
  {
    name: 'gpu-spot',
    namespace: 'karpenter',
    uid: 'np-gpu-spot-uid',
    creationTimestamp: '2024-03-01T11:00:00Z',
    weight: 50,
    nodeClassRef: { group: 'karpenter.k8s.aws', kind: 'EC2NodeClass', name: 'gpu' },
    requirements: [
      { key: 'karpenter.sh/capacity-type', operator: 'In', values: ['spot'] },
    ],
  },
];

const ec2NodeClasses: EC2NodeClassSummary[] = [
  {
    name: 'default',
    namespace: 'karpenter',
    uid: 'enc-default',
    amiFamily: 'AL2',
    role: 'KarpenterNodeRole-default',
    subnetSelectorTerms: 2,
    securityGroupSelectorTerms: 1,
    amiSelectorTerms: 3,
  },
  {
    name: 'gpu',
    namespace: 'karpenter',
    uid: 'enc-gpu',
    amiFamily: 'AL2',
    role: 'KarpenterNodeRole-gpu',
    subnetSelectorTerms: 3,
    securityGroupSelectorTerms: 2,
  },
];

const nodeClaims: NodeClaimSummary[] = [
  {
    name: 'default-abc12',
    namespace: 'karpenter',
    uid: 'nc-abc12',
    nodePool: 'default',
    nodeName: 'ip-10-0-1-23.ec2.internal',
    capacityType: 'on-demand',
    instanceType: 'm5.large',
    zone: 'us-east-1a',
    architecture: 'amd64',
    phase: 'Running',
    creationTimestamp: '2024-03-02T09:30:00Z',
    ageSeconds: 3600,
    capacity: { cpu: '2', memory: '8Gi', pods: '110' },
  },
  {
    name: 'gpu-spot-xyz34',
    namespace: 'karpenter',
    uid: 'nc-xyz34',
    nodePool: 'gpu-spot',
    nodeName: 'ip-10-0-2-77.ec2.internal',
    capacityType: 'spot',
    instanceType: 'g5.2xlarge',
    zone: 'us-east-1b',
    architecture: 'amd64',
    phase: 'Running',
    creationTimestamp: '2024-03-02T09:35:00Z',
    ageSeconds: 1800,
  },
];

const nodes: NodeSummary[] = [
  {
    name: 'ip-10-0-1-23.ec2.internal',
    uid: 'node-uid-abc12',
    instanceType: 'm5.large',
    zone: 'us-east-1a',
    region: 'us-east-1',
    architecture: 'amd64',
    os: 'linux',
    capacityType: 'on-demand',
    nodeClaim: 'default-abc12',
    nodePool: 'default',
    ready: true,
    cpuCapacity: '2',
    memoryCapacity: '8Gi',
    podCapacity: '110',
    creationTimestamp: '2024-03-02T09:31:00Z',
    ageSeconds: 3500,
    labels: {
      'karpenter.sh/nodepool': 'default',
      'karpenter.sh/capacity-type': 'on-demand',
      'karpenter.k8s.aws/instance-type': 'm5.large',
      'kubernetes.io/hostname': 'ip-10-0-1-23.ec2.internal',
    },
  },
  {
    name: 'ip-10-0-2-77.ec2.internal',
    uid: 'node-uid-xyz34',
    instanceType: 'g5.2xlarge',
    zone: 'us-east-1b',
    architecture: 'amd64',
    os: 'linux',
    capacityType: 'spot',
    nodeClaim: 'gpu-spot-xyz34',
    nodePool: 'gpu-spot',
    ready: true,
    cpuCapacity: '8',
    memoryCapacity: '32Gi',
    podCapacity: '110',
    creationTimestamp: '2024-03-02T09:36:00Z',
    ageSeconds: 1500,
    labels: {
      'karpenter.sh/nodepool': 'gpu-spot',
      'karpenter.sh/capacity-type': 'spot',
      'karpenter.k8s.aws/instance-type': 'g5.2xlarge',
    },
  },
];

const pendingPods: PendingPodEvidence[] = [
  {
    pod: {
      name: 'batch-processor-1',
      namespace: 'batch',
      uid: 'pod-batch-1',
      phase: 'Pending',
      creationTimestamp: '2024-03-02T10:00:00Z',
      ageSeconds: 300,
    },
    evidence: {
      requests: { cpu: '1', memory: '2Gi' },
      nodeSelector: { workload: 'batch' },
      affinity: {
        nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: {} },
        podAffinity: null,
        podAntiAffinity: null,
      },
      topologySpreadConstraints: [
        { topologyKey: 'topology.kubernetes.io/zone', maxSkew: 1 },
      ],
      tolerations: [
        { key: 'dedicated', operator: 'Equal', value: 'batch', effect: 'NoSchedule' },
      ],
      karpenterLabels: { 'karpenter.sh/nodepool': 'default' },
      reasons: ['0/2 nodes available', '1 node(s) had untolerated taint'],
    },
  },
  {
    pod: {
      name: 'metrics-scraper',
      namespace: 'monitoring',
      uid: 'pod-scraper',
      phase: 'Pending',
      creationTimestamp: '2024-03-02T10:01:00Z',
      ageSeconds: 60,
    },
    evidence: {
      requests: { cpu: '100m', memory: '128Mi' },
      nodeSelector: {},
      affinity: null,
      topologySpreadConstraints: [],
      tolerations: [],
      karpenterLabels: {},
      reasons: [],
    },
  },
];

const pendingPodResponse: PendingPodResponse = {
  items: pendingPods,
  totalCount: pendingPods.length,
  generatedAt: '2024-03-02T10:30:00Z',
};

const events: EventSummary[] = [
  {
    type: 'Normal',
    reason: 'Created',
    message: 'Created instance i-0123456789abcdef0 on AWS',
    involvedObject: { kind: 'NodeClaim', namespace: 'karpenter', name: 'default-abc12' },
    namespace: 'karpenter',
    lastTimestamp: new Date(Date.now() - 60_000).toISOString(),
    ageSeconds: 60,
  },
  {
    type: 'Warning',
    reason: 'FailedScheduling',
    message: '0/2 nodes are available: 1 insufficient cpu, 1 node(s) had untolerated taint {karpenter.sh/unregistered: true}, 1 node(s) had volume node affinity conflict.',
    involvedObject: { kind: 'Pod', namespace: 'batch', name: 'batch-processor-1' },
    namespace: 'batch',
    lastTimestamp: new Date(Date.now() - 5 * 60_000).toISOString(),
    ageSeconds: 300,
  },
  {
    type: 'Normal',
    reason: 'Scheduled',
    message: 'Successfully assigned api-7c9b-abc to ip-10-0-1-23.ec2.internal',
    involvedObject: { kind: 'Pod', namespace: 'prod', name: 'api-7c9b-abc' },
    namespace: 'prod',
    lastTimestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
    ageSeconds: 600,
  },
];

// ---------------------------------------------------------------------------
// Fetch stubbing helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Deferred = {
  url: string;
  resolve: (value: Response) => void;
  reject: (err: Error) => void;
};

function installDeferredFetch(): {
  pending: Deferred[];
  resolvePending: (mapper: (url: string) => Response) => void;
} {
  const pending: Deferred[] = [];
  const mock = vi.fn(
    (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      return new Promise<Response>((resolve, reject) => {
        pending.push({ url, resolve, reject });
      });
    },
  );
  vi.stubGlobal('fetch', mock as unknown as typeof fetch);

  const resolvePending = (mapper: (url: string) => Response): void => {
    for (const entry of pending) entry.resolve(mapper(entry.url));
    pending.length = 0;
  };

  return { pending, resolvePending };
}

function installImmediateFetch(
  mapper: (url: string) => Response,
): ReturnType<typeof vi.fn> {
  const mock = vi.fn(
    (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      return Promise.resolve(mapper(url));
    },
  );
  vi.stubGlobal('fetch', mock as unknown as typeof fetch);
  return mock;
}

function defaultApiMap(url: string): Response {
  if (url.endsWith('/api/nodepools')) return jsonResponse(nodePools);
  if (url.endsWith('/api/nodeclaims')) return jsonResponse(nodeClaims);
  if (url.endsWith('/api/nodes')) return jsonResponse(nodes);
  if (url.endsWith('/api/ec2nodeclasses')) return jsonResponse(ec2NodeClasses);
  if (url.endsWith('/api/pending-pods')) return jsonResponse(pendingPodResponse);
  if (url.endsWith('/api/events')) return jsonResponse(events);
  return jsonResponse({}, 404);
}

// ---------------------------------------------------------------------------
// Shared test harness
// ---------------------------------------------------------------------------

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  document.body.removeChild(container);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderPage(element: React.ReactElement): Promise<void> {
  const root = createRoot(container);
  await act(async () => {
    root.render(<BrowserRouter>{element}</BrowserRouter>);
  });
}

// ---------------------------------------------------------------------------
// NodePools page
// ---------------------------------------------------------------------------

describe('<NodePools />', () => {
  it('renders a ResourceTable with rows from the API', async () => {
    const { resolvePending } = installDeferredFetch();
    await renderPage(<NodePools />);

    await act(async () => {
      resolvePending(defaultApiMap);
    });

    const table = container.querySelector('[data-testid="resource-table"]');
    expect(table).not.toBeNull();
    const rows = container.querySelectorAll('[data-testid="resource-table-row"]');
    expect(rows.length).toBe(nodePools.length);
    const text = table?.textContent ?? '';
    expect(text).toContain('default');
    expect(text).toContain('gpu-spot');
    // NodeClass column renders the EC2NodeClass name from nodeClassRef.
    expect(text).toContain('default');
    expect(text).toContain('gpu');
    // The detail panel will reference EC2NodeClass — first click the row.
    const firstRow = container.querySelector(
      '[data-testid="resource-table-row"]',
    ) as HTMLElement | null;
    await act(async () => {
      firstRow!.click();
    });
    const detail = container.querySelector('[data-testid="nodepool-detail"]');
    expect(detail?.textContent ?? '').toContain('EC2NodeClass');
  });

  it('shows details when a NodePool row is clicked', async () => {
    const { resolvePending } = installDeferredFetch();
    await renderPage(<NodePools />);

    await act(async () => {
      resolvePending(defaultApiMap);
    });

    const firstRow = container.querySelector(
      '[data-testid="resource-table-row"]',
    ) as HTMLElement | null;
    expect(firstRow).not.toBeNull();

    await act(async () => {
      firstRow!.click();
    });

    const detail = container.querySelector('[data-testid="nodepool-detail"]');
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain('NodePool');
    // Detail shows raw spec/status via a CodeBlock.
    const code = container.querySelector('[data-testid="code-block"]');
    expect(code).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// NodeClaims page
// ---------------------------------------------------------------------------

describe('<NodeClaims />', () => {
  it('renders capacity type and instance type badges', async () => {
    installImmediateFetch(defaultApiMap);
    await renderPage(<NodeClaims />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const rows = container.querySelectorAll('[data-testid="resource-table-row"]');
    expect(rows.length).toBe(nodeClaims.length);

    const badges = container.querySelectorAll('[data-testid="badge"]');
    expect(badges.length).toBeGreaterThanOrEqual(4); // 2 capacity + 2 instance
    const badgeText = Array.from(badges).map((b) => b.textContent).join(' | ');
    expect(badgeText).toContain('on-demand');
    expect(badgeText).toContain('spot');
    expect(badgeText).toContain('m5.large');
    expect(badgeText).toContain('g5.2xlarge');
  });
});

// ---------------------------------------------------------------------------
// Nodes page
// ---------------------------------------------------------------------------

describe('<Nodes />', () => {
  it('renders nodes including Karpenter labels in the detail panel', async () => {
    installImmediateFetch(defaultApiMap);
    await renderPage(<Nodes />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const rows = container.querySelectorAll('[data-testid="resource-table-row"]');
    expect(rows.length).toBe(nodes.length);
    const text = container.querySelector('[data-testid="resource-table"]')?.textContent ?? '';
    expect(text).toContain('ip-10-0-1-23.ec2.internal');
    expect(text).toContain('ip-10-0-2-77.ec2.internal');

    // Click first node row to open details.
    const firstRow = container.querySelector(
      '[data-testid="resource-table-row"]',
    ) as HTMLElement | null;
    await act(async () => {
      firstRow!.click();
    });

    const detail = container.querySelector('[data-testid="node-detail"]');
    expect(detail).not.toBeNull();
    const labelsContainer = container.querySelector(
      '[data-testid="node-karpenter-labels"]',
    );
    expect(labelsContainer).not.toBeNull();
    const labelsText = labelsContainer?.textContent ?? '';
    expect(labelsText).toContain('karpenter.sh/nodepool');
    expect(labelsText).toContain('karpenter.sh/capacity-type');
    expect(labelsText).toContain('karpenter.k8s.aws/instance-type');
  });
});

// ---------------------------------------------------------------------------
// PendingPods page
// ---------------------------------------------------------------------------

describe('<PendingPods />', () => {
  it('renders the scheduling evidence columns', async () => {
    installImmediateFetch(defaultApiMap);
    await renderPage(<PendingPods />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const rows = container.querySelectorAll('[data-testid="resource-table-row"]');
    expect(rows.length).toBe(pendingPods.length);
    const text = container.querySelector('[data-testid="resource-table"]')?.textContent ?? '';
    expect(text).toContain('batch-processor-1');
    expect(text).toContain('metrics-scraper');

    // Column headers present
    const headers = container.querySelectorAll(
      '[data-testid^="resource-table-th-"]',
    );
    const headerText = Array.from(headers).map((h) => h.textContent).join(' | ');
    expect(headerText).toContain('Requests');
    expect(headerText).toContain('Node Selector');
    expect(headerText).toContain('Affinity');
    expect(headerText).toContain('Tolerations');
    expect(headerText).toContain('Topology Constraints');

    // The advanced pending pod shows affinity = yes and has reasons.
    const affinityCells = container.querySelectorAll(
      '[data-testid="pending-pod-affinity"]',
    );
    const affinityText = Array.from(affinityCells)
      .map((c) => c.textContent)
      .join(' | ');
    expect(affinityText).toContain('yes');
    expect(affinityText).toContain('no');
  });

  it('opens detail with raw pod spec when a row is clicked', async () => {
    installImmediateFetch(defaultApiMap);
    await renderPage(<PendingPods />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const firstRow = container.querySelector(
      '[data-testid="resource-table-row"]',
    ) as HTMLElement | null;
    await act(async () => {
      firstRow!.click();
    });

    const detail = container.querySelector('[data-testid="pending-pod-detail"]');
    expect(detail).not.toBeNull();
    const codeBlocks = container.querySelectorAll('[data-testid="code-block"]');
    expect(codeBlocks.length).toBeGreaterThan(0);
    const reasons = container.querySelector('[data-testid="pending-pod-reasons"]');
    expect(reasons).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Events page
// ---------------------------------------------------------------------------

describe('<Events />', () => {
  it('renders filtered events when the kind dropdown changes', async () => {
    installImmediateFetch(defaultApiMap);
    await renderPage(<Events />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const rows = container.querySelectorAll('[data-testid="resource-table-row"]');
    expect(rows.length).toBe(events.length);

    // Apply NodeClaim kind filter.
    const select = container.querySelector(
      '[data-testid="events-kind-filter"]',
    ) as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value',
      )?.set;
      setter?.call(select, 'NodeClaim');
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const filteredRows = container.querySelectorAll(
      '[data-testid="resource-table-row"]',
    );
    expect(filteredRows.length).toBe(1);
    expect(filteredRows[0].textContent).toContain('NodeClaim');

    // Reset and apply reason text filter.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value',
      )?.set;
      setter?.call(select, 'all');
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const reasonInput = container.querySelector(
      '[data-testid="events-reason-filter"]',
    ) as HTMLInputElement | null;
    expect(reasonInput).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(reasonInput, 'Failed');
      reasonInput!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const reasonRows = container.querySelectorAll(
      '[data-testid="resource-table-row"]',
    );
    expect(reasonRows.length).toBe(1);
    expect(reasonRows[0].textContent).toContain('FailedScheduling');
  });

  it('truncates long messages and stores the full message in title', async () => {
    installImmediateFetch(defaultApiMap);
    await renderPage(<Events />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const messages = container.querySelectorAll('.kv-list-page__message');
    const failed = Array.from(messages).find(
      (m) => m.getAttribute('title')?.startsWith('0/2 nodes are available'),
    );
    expect(failed).toBeDefined();
    // The title attribute holds the full text.
    expect(failed?.getAttribute('title') ?? '').toContain('volume node affinity conflict');
    // The visible text is truncated to less than the full message length.
    const visible = failed?.textContent ?? '';
    expect(visible.length).toBeLessThan(144);
  });
});
