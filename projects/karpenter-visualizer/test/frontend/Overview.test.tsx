import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { BrowserRouter } from 'react-router-dom';
import Overview from '../../src/frontend/pages/Overview';
import type { EventSummary, TopologyResponse } from '../../src/shared/types';

const topologyResponse: TopologyResponse = {
  nodePools: [
    { name: 'default', namespace: 'karpenter' },
    { name: 'gpu-spot', namespace: 'karpenter' },
  ],
  nodeClaims: [
    {
      name: 'default-abc12',
      namespace: 'karpenter',
      nodePool: 'default',
      capacityType: 'on-demand',
    },
    {
      name: 'gpu-spot-xyz34',
      namespace: 'karpenter',
      nodePool: 'gpu-spot',
      capacityType: 'spot',
    },
  ],
  ec2NodeClasses: [
    {
      name: 'default',
      namespace: 'karpenter',
      subnetSelectorTerms: 2,
      securityGroupSelectorTerms: 1,
    },
  ],
  nodes: [
    {
      name: 'ip-10-0-1-23.ec2.internal',
      ready: true,
      capacityType: 'on-demand',
      cpuCapacity: '2',
      memoryCapacity: '8Gi',
    },
    {
      name: 'ip-10-0-2-77.ec2.internal',
      ready: true,
      capacityType: 'spot',
      cpuCapacity: '8',
      memoryCapacity: '61Gi',
    },
  ],
  pods: [
    { name: 'api-7c9b-abc', namespace: 'prod', phase: 'Running' },
    { name: 'trainer-5d8f-xyz', namespace: 'ml', phase: 'Running' },
    { name: 'metrics-scraper', namespace: 'monitoring', phase: 'Pending' },
  ],
  pendingPods: [],
  events: [
    {
      type: 'Normal',
      reason: 'Created',
      message: 'Created instance i-0123456789abcdef0',
      involvedObject: { kind: 'NodeClaim', name: 'default-abc12' },
      namespace: 'karpenter',
      lastTimestamp: new Date(Date.now() - 60_000).toISOString(),
    },
  ],
  cluster: {
    nodePoolCount: 2,
    nodeClaimCount: 2,
    ec2NodeClassCount: 1,
    nodeCount: 2,
    readyNodeCount: 2,
    pendingPodCount: 1,
    spotCount: 1,
    onDemandCount: 1,
    totalCpu: '10',
    totalMemory: '69Gi',
    recentEventCount: 1,
  },
  generatedAt: '2024-03-02T10:30:00Z',
};

const eventsResponse: EventSummary[] = [
  {
    type: 'Normal',
    reason: 'Created',
    message: 'Created instance i-0123456789abcdef0 on AWS',
    involvedObject: {
      kind: 'NodeClaim',
      namespace: 'karpenter',
      name: 'default-abc12',
    },
    namespace: 'karpenter',
    lastTimestamp: new Date(Date.now() - 2 * 60_000).toISOString(),
  },
  {
    type: 'Normal',
    reason: 'Scheduled',
    message: 'Successfully assigned api-7c9b-abc to ip-10-0-1-23.ec2.internal',
    involvedObject: {
      kind: 'Pod',
      namespace: 'prod',
      name: 'api-7c9b-abc',
    },
    namespace: 'prod',
    lastTimestamp: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
  {
    type: 'Warning',
    reason: 'FailedScheduling',
    message:
      '0/2 nodes are available: 1 insufficient nvidia.com/gpu, 1 node(s) had untolerated taint {karpenter.sh/unregistered: true}, 1 node(s) had volume node affinity conflict, 1 node(s) were unschedulable due to topology spread constraints across zones.',
    involvedObject: {
      kind: 'Pod',
      namespace: 'batch',
      name: 'batch-processor-1',
    },
    namespace: 'batch',
    lastTimestamp: new Date(Date.now() - 8 * 60_000).toISOString(),
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('<Overview />', () => {
  let container: HTMLDivElement;
  // Queue of pending fetch calls, each with a manual resolver.
  let pending: Array<{
    url: string;
    resolve: (value: Response) => void;
    reject: (err: Error) => void;
  }>;

  function installDeferredFetch(): void {
    pending = [];
    const mock = vi.fn(
      (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input.toString();
        return new Promise<Response>((resolve, reject) => {
          pending.push({ url, resolve, reject });
        });
      },
    );
    vi.stubGlobal('fetch', mock as unknown as typeof fetch);
  }

  function installImmediateFetch(impl: (url: string) => Response): void {
    const mock = vi.fn(
      (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input.toString();
        return Promise.resolve(impl(url));
      },
    );
    vi.stubGlobal('fetch', mock as unknown as typeof fetch);
  }

  function resolvePending(): void {
    for (const entry of pending) {
      if (entry.url.endsWith('/api/topology')) {
        entry.resolve(jsonResponse(topologyResponse));
      } else if (entry.url.endsWith('/api/events')) {
        entry.resolve(jsonResponse(eventsResponse));
      } else {
        entry.resolve(jsonResponse({}, 404));
      }
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

  async function renderOverview(): Promise<void> {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <BrowserRouter>
          <Overview />
        </BrowserRouter>,
      );
    });
  }

  it('shows a loading indicator before data arrives', async () => {
    await renderOverview();
    // fetch is still pending — loading state must be visible.
    expect(container.querySelector('[data-testid="kv-loading"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="overview-stats"]'),
    ).toBeNull();

    // Drain pending fetches so React state updates commit and no promises leak.
    await act(async () => {
      resolvePending();
    });
  });

  it('renders stat cards with counts from the topology response', async () => {
    await renderOverview();
    await act(async () => {
      resolvePending();
    });

    const stats = container.querySelector('[data-testid="overview-stats"]');
    expect(stats).not.toBeNull();

    const expectStat = (slug: string, expected: string): void => {
      const el = container.querySelector(`[data-testid="stat-card-${slug}"]`);
      expect(el).not.toBeNull();
      expect(el?.textContent).toContain(expected);
    };

    expectStat('nodepools', '2');
    expectStat('nodeclaims', '2');
    expectStat('nodes', '2');
    expectStat('pods', '3');
    expectStat('pending-pods', '1');
    expectStat('ec2nodeclasses', '1');
  });

  it('renders the recent events list once events load', async () => {
    await renderOverview();
    await act(async () => {
      resolvePending();
    });

    const list = container.querySelector('[data-testid="event-list"]');
    expect(list).not.toBeNull();
    const rows = container.querySelectorAll('[data-testid="event-row"]');
    expect(rows.length).toBe(3);
    expect(list?.textContent).toContain('Created');
    expect(list?.textContent).toContain('Scheduled');
    expect(list?.textContent).toContain('FailedScheduling');
    expect(list?.textContent).toContain('NodeClaim');
    expect(list?.textContent).toContain('Pod');
  });

  it('shows relative timestamps for events', async () => {
    await renderOverview();
    await act(async () => {
      resolvePending();
    });

    const list = container.querySelector('[data-testid="event-list"]');
    expect(list?.textContent).toMatch(/2m ago|1m ago/);
  });

  it('truncates long messages while keeping the full text in the title attribute', async () => {
    await renderOverview();
    await act(async () => {
      resolvePending();
    });

    const messageCells = container.querySelectorAll(
      '.kv-event-list__cell--message',
    );
    const failedCell = Array.from(messageCells).find((c) =>
      c.getAttribute('title')?.includes('0/2 nodes are available'),
    );
    expect(failedCell).toBeDefined();
    const titleAttr = failedCell?.getAttribute('title') ?? '';
    expect(titleAttr.length).toBeGreaterThan(140);
    expect(failedCell?.textContent ?? '').toContain('…');
  });

  it('renders an error message when the topology request fails', async () => {
    installImmediateFetch((url) => {
      if (url.endsWith('/api/topology')) {
        return new Response('boom', { status: 500 });
      }
      return jsonResponse(eventsResponse);
    });

    await renderOverview();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const errorEl = container.querySelector('[data-testid="kv-error"]');
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent).toContain('500');
    expect(
      container.querySelector('[data-testid="overview-stats"]'),
    ).toBeNull();
  });
});
