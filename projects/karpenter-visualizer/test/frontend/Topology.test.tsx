import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { BrowserRouter } from 'react-router-dom';
import Topology from '../../src/frontend/pages/Topology';
import type { TopologyResponse } from '../../src/shared/types';

const topologyResponse: TopologyResponse = {
  nodePools: [
    {
      name: 'default',
      namespace: 'karpenter',
      uid: 'np-default-uid',
      creationTimestamp: '2024-03-01T10:00:00Z',
      weight: 100,
      nodeClassRef: { group: 'karpenter.k8s.aws', kind: 'EC2NodeClass', name: 'default' },
      requirements: [{ key: 'karpenter.sh/capacity-type', operator: 'In', values: ['spot', 'on-demand'] }],
    },
  ],
  nodeClaims: [
    {
      name: 'default-abc12',
      namespace: 'karpenter',
      uid: 'nc-abc12-uid',
      nodePool: 'default',
      capacityType: 'on-demand',
      instanceType: 'm5.large',
      zone: 'us-east-1a',
      architecture: 'amd64',
      phase: 'Running',
      creationTimestamp: '2024-03-02T09:30:00Z',
    },
  ],
  ec2NodeClasses: [
    {
      name: 'default',
      namespace: 'karpenter',
      uid: 'enc-default-uid',
      subnetSelectorTerms: 2,
      securityGroupSelectorTerms: 1,
      amiFamily: 'AL2',
      role: 'KarpenterNodeRole-default',
    },
  ],
  nodes: [
    {
      name: 'ip-10-0-1-23.ec2.internal',
      uid: 'node-uid-abc12',
      instanceType: 'm5.large',
      zone: 'us-east-1a',
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
    },
  ],
  pods: [
    {
      name: 'api-7c9b-abc',
      namespace: 'prod',
      uid: 'pod-api-uid',
      phase: 'Running',
      nodeName: 'ip-10-0-1-23.ec2.internal',
      nodePool: 'default',
      creationTimestamp: '2024-03-02T09:35:00Z',
    },
    {
      name: 'worker-5d8f-xyz',
      namespace: 'prod',
      uid: 'pod-worker-uid',
      phase: 'Running',
      nodeName: 'ip-10-0-1-23.ec2.internal',
      nodePool: 'default',
      creationTimestamp: '2024-03-02T09:36:00Z',
    },
  ],
  pendingPods: [],
  events: [],
  cluster: {
    nodePoolCount: 1,
    nodeClaimCount: 1,
    ec2NodeClassCount: 1,
    nodeCount: 1,
    readyNodeCount: 1,
    pendingPodCount: 0,
    spotCount: 0,
    onDemandCount: 1,
    totalCpu: '2',
    totalMemory: '8Gi',
    recentEventCount: 0,
  },
  generatedAt: '2024-03-02T10:30:00Z',
};

const emptyResponse: TopologyResponse = {
  nodePools: [],
  nodeClaims: [],
  ec2NodeClasses: [],
  nodes: [],
  pods: [],
  pendingPods: [],
  events: [],
  cluster: {
    nodePoolCount: 0,
    nodeClaimCount: 0,
    ec2NodeClassCount: 0,
    nodeCount: 0,
    readyNodeCount: 0,
    pendingPodCount: 0,
    spotCount: 0,
    onDemandCount: 0,
    totalCpu: '0',
    totalMemory: '0',
    recentEventCount: 0,
  },
  generatedAt: '2024-03-02T10:30:00Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('<Topology />', () => {
  let container: HTMLDivElement;
  let pending: Array<{
    url: string;
    resolve: (value: Response) => void;
    reject: (err: Error) => void;
  }>;

  function installDeferredFetch(): void {
    pending = [];
    const mock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        return new Promise<Response>((resolve, reject) => {
          pending.push({ url: '/api/topology', resolve, reject });
        });
      },
    );
    vi.stubGlobal('fetch', mock as unknown as typeof fetch);
  }

  function installImmediateFetch(body: TopologyResponse): void {
    const mock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        return Promise.resolve(jsonResponse(body));
      },
    );
    vi.stubGlobal('fetch', mock as unknown as typeof fetch);
  }

  function installErrorFetch(status = 500): void {
    const mock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        return Promise.resolve(jsonResponse({}, status));
      },
    );
    vi.stubGlobal('fetch', mock as unknown as typeof fetch);
  }

  function resolvePending(): void {
    for (const entry of pending) {
      entry.resolve(jsonResponse(topologyResponse));
    }
    pending = [];
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    installDeferredFetch();
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderTopology(): Promise<void> {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <BrowserRouter>
          <Topology />
        </BrowserRouter>,
      );
    });
  }

  it('shows a loading indicator before topology data arrives', async () => {
    await renderTopology();
    expect(container.querySelector('[data-testid="kv-loading"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="topology-tree"]'),
    ).toBeNull();

    await act(async () => {
      resolvePending();
    });
  });

  it('renders the NodePool name from the topology response', async () => {
    await renderTopology();
    await act(async () => {
      resolvePending();
    });

    const pool = container.querySelector('[data-testid="topology-node-pool"]');
    expect(pool).not.toBeNull();
    expect(pool?.textContent).toContain('default');
    expect(pool?.textContent).toContain('NodePool');
  });

  it('expands NodeClaims when the NodePool chevron is clicked', async () => {
    await renderTopology();
    await act(async () => {
      resolvePending();
    });

    // Initially collapsed — no NodeClaim visible.
    expect(
      container.querySelector('[data-testid="topology-node-claim"]'),
    ).toBeNull();

    // Click the chevron on the NodePool row.
    const poolRow = container.querySelector(
      '[data-testid="topology-node-pool"] .kv-topology-node__row',
    );
    const chevron = poolRow?.querySelector(
      '[data-testid="expand-toggle"]',
    ) as HTMLButtonElement | null;
    expect(chevron).not.toBeNull();

    await act(async () => {
      chevron!.click();
    });

    const claim = container.querySelector('[data-testid="topology-node-claim"]');
    expect(claim).not.toBeNull();
    expect(claim?.textContent).toContain('default-abc12');

    // Collapse again.
    await act(async () => {
      chevron!.click();
    });
    expect(
      container.querySelector('[data-testid="topology-node-claim"]'),
    ).toBeNull();
  });

  it('renders Node and Pod rows once the chain is expanded', async () => {
    await renderTopology();
    await act(async () => {
      resolvePending();
    });

    const poolRow = container.querySelector(
      '[data-testid="topology-node-pool"] .kv-topology-node__row',
    );
    const poolChevron = poolRow?.querySelector(
      '[data-testid="expand-toggle"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      poolChevron!.click();
    });

    const claimRow = container.querySelector(
      '[data-testid="topology-node-claim"] .kv-topology-node__row',
    );
    const claimChevron = claimRow?.querySelector(
      '[data-testid="expand-toggle"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      claimChevron!.click();
    });

    const node = container.querySelector('[data-testid="topology-node"]');
    expect(node).not.toBeNull();
    expect(node?.textContent).toContain('ip-10-0-1-23.ec2.internal');

    // Pods hidden until Node is expanded.
    expect(container.querySelector('[data-testid="topology-pod"]')).toBeNull();

    const nodeRow = container.querySelector(
      '[data-testid="topology-node"] .kv-topology-node__row',
    );
    const nodeChevron = nodeRow?.querySelector(
      '[data-testid="expand-toggle"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      nodeChevron!.click();
    });

    const pods = container.querySelectorAll('[data-testid="topology-pod"]');
    expect(pods.length).toBe(2);
    const podText = Array.from(pods).map((p) => p.textContent).join(' | ');
    expect(podText).toContain('api-7c9b-abc');
    expect(podText).toContain('worker-5d8f-xyz');
  });

  it('collapses Pods when the Node chevron is clicked again', async () => {
    await renderTopology();
    await act(async () => {
      resolvePending();
    });

    const click = async (selector: string): Promise<void> => {
      const el = container.querySelector(selector);
      const chevron = el?.querySelector(
        '[data-testid="expand-toggle"]',
      ) as HTMLButtonElement | null;
      await act(async () => {
        chevron!.click();
      });
    };

    await click('[data-testid="topology-node-pool"] .kv-topology-node__row');
    await click('[data-testid="topology-node-claim"] .kv-topology-node__row');
    await click('[data-testid="topology-node"] .kv-topology-node__row');

    expect(container.querySelectorAll('[data-testid="topology-pod"]').length).toBe(2);

    await click('[data-testid="topology-node"] .kv-topology-node__row');
    expect(container.querySelector('[data-testid="topology-pod"]')).toBeNull();
  });

  it('shows the details panel when an item is selected', async () => {
    await renderTopology();
    await act(async () => {
      resolvePending();
    });

    // Click the NodePool name to open the details panel.
    const poolNameButton = container.querySelector(
      '[data-testid="topology-node-pool"] .kv-topology-node__name',
    ) as HTMLButtonElement | null;
    expect(poolNameButton).not.toBeNull();

    await act(async () => {
      poolNameButton!.click();
    });

    const panel = container.querySelector('[data-testid="detail-panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('NodePool');
    expect(panel?.textContent).toContain('default');
    expect(panel?.textContent).toContain('np-default-uid');
    // EC2NodeClass relationship is rendered.
    expect(panel?.textContent).toContain('EC2NodeClass');
  });

  it('toggles the details panel off when the same item is clicked again', async () => {
    await renderTopology();
    await act(async () => {
      resolvePending();
    });

    const poolNameButton = container.querySelector(
      '[data-testid="topology-node-pool"] .kv-topology-node__name',
    ) as HTMLButtonElement | null;

    await act(async () => {
      poolNameButton!.click();
    });
    expect(
      container.querySelector('[data-testid="detail-panel"]')?.textContent ?? '',
    ).toContain('NodePool: default');

    await act(async () => {
      poolNameButton!.click();
    });
    // No selection — panel renders the empty placeholder.
    expect(
      container.querySelector('[data-testid="detail-panel"]')?.textContent ?? '',
    ).toContain('Select an item');
  });

  it('shows a friendly empty message when topology has no resources', async () => {
    installImmediateFetch(emptyResponse);
    await renderTopology();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const page = container.querySelector('[data-testid="topology-page"]');
    expect(page).not.toBeNull();
    expect(page?.textContent ?? '').toMatch(/no Karpenter-managed/i);
    expect(container.querySelector('[data-testid="topology-tree"]')).toBeNull();
  });

  it('renders an error message when the topology request fails', async () => {
    installErrorFetch(500);
    await renderTopology();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const errorEl = container.querySelector('[data-testid="kv-error"]');
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent).toContain('500');
    expect(container.querySelector('[data-testid="topology-tree"]')).toBeNull();
  });

  it('displays badges with capacity type and instance type on the NodeClaim', async () => {
    await renderTopology();
    await act(async () => {
      resolvePending();
    });

    const poolChevron = container
      .querySelector('[data-testid="topology-node-pool"] .kv-topology-node__row')
      ?.querySelector('[data-testid="expand-toggle"]') as HTMLButtonElement | null;
    await act(async () => {
      poolChevron!.click();
    });

    const claim = container.querySelector('[data-testid="topology-node-claim"]');
    expect(claim?.textContent).toContain('on-demand');
    expect(claim?.textContent).toContain('m5.large');
    expect(claim?.textContent).toContain('us-east-1a');
  });
});
