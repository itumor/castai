/**
 * End-to-end test: pending pod -> NodeClaim -> Node -> scheduled pod flow.
 *
 * Drives a real Chromium browser against the deployed app:
 *   - the Express backend is started with MOCK_K8S=true (no real cluster)
 *   - the Vite frontend is served as a static build
 *   - the mock cluster is seeded with the standard fixtures via
 *     /api/_test/seed
 *
 * The test exercises:
 *   1. Topology page: NodePool -> NodeClaim -> Node -> Pod hierarchy
 *      renders and is expandable; pod names appear once expanded.
 *   2. Pending Pods page: pending pod shows scheduling evidence
 *      (requests, node selector, affinity, tolerations, topology).
 *   3. Scheduling simulation: re-seed mock data so the pending pod is
 *      bound to the gpu-spot Node, then verify the topology updates
 *      (reload page) and the pod moves out of Pending Pods.
 *   4. Events page: Karpenter-related events (Created/Scheduled) render.
 */

import { test, expect, request as pwRequest } from '@playwright/test';
import {
  mockCluster,
  nodePoolFixtures,
  nodeClaimFixtures,
  nodeFixtures,
  podFixtures,
} from '../fixtures/cluster.js';
import {
  NODEPOOL_DEFAULT_NAME,
  NODEPOOL_GPU_SPOT_NAME,
} from '../fixtures/nodepool.js';
import {
  NODECLAIM_DEFAULT_NAME,
  NODECLAIM_GPU_SPOT_NAME,
} from '../fixtures/nodeclaim.js';
import { NODE_NAME_GPU_SPOT, NODE_NAME_DEFAULT } from '../fixtures/nodeclaim.js';
import {
  POD_RUNNING_DEFAULT_NAME,
  POD_RUNNING_GPU_NAME,
  POD_PENDING_ADVANCED_NAME,
} from '../fixtures/pod.js';

const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 3101);
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;

test.describe('Karpenter visualizer — pending -> scheduled flow', () => {
  test.beforeAll(async () => {
    // Seed the mock cluster through the test-only endpoint. The route
    // is only mounted when MOCK_K8S=true so it can never reach a real
    // cluster.
    const ctx = await pwRequest.newContext({ baseURL: BACKEND_ORIGIN });
    const res = await ctx.post('/api/_test/seed', { data: mockCluster });
    expect(res.ok()).toBeTruthy();
    await ctx.dispose();
  });

  test('topology renders NodePool -> NodeClaim -> Node -> Pod', async ({ page }) => {
    await page.goto('/topology');

    await expect(page.getByTestId('topology-page')).toBeVisible();
    await expect(page.getByTestId('topology-tree')).toBeVisible();

    // Both NodePools from the fixtures should appear at the root.
    // Match by the button's `title` attribute (set to the NodePool
    // name) to avoid spurious matches against the EC2NodeClass
    // badge text.
    const nodePools = page.getByTestId('topology-node-pool');
    await expect(nodePools).toHaveCount(nodePoolFixtures.length);
    await expect(
      nodePools.locator(`button[title="${NODEPOOL_DEFAULT_NAME}"]`),
    ).toHaveCount(1);
    await expect(
      nodePools.locator(`button[title="${NODEPOOL_GPU_SPOT_NAME}"]`),
    ).toHaveCount(1);

    // Expand the gpu-spot NodePool.
    const gpuPool = nodePools
      .locator(`button[title="${NODEPOOL_GPU_SPOT_NAME}"]`)
      .locator('xpath=ancestor::*[@data-testid="topology-node-pool"][1]');
    await gpuPool.getByTestId('expand-toggle').click();

    // The gpu-spot NodeClaim should now be visible.
    const claims = page.getByTestId('topology-node-claim');
    await expect(
      claims.locator(`button[title="${NODECLAIM_GPU_SPOT_NAME}"]`),
    ).toHaveCount(1);

    // Expand the gpu-spot NodeClaim and then the gpu-spot Node.
    const gpuClaim = claims
      .locator(`button[title="${NODECLAIM_GPU_SPOT_NAME}"]`)
      .locator('xpath=ancestor::*[@data-testid="topology-node-claim"][1]');
    await gpuClaim.getByTestId('expand-toggle').click();

    const nodes = page.getByTestId('topology-node');
    await expect(
      nodes.locator(`button[title="${NODE_NAME_GPU_SPOT}"]`),
    ).toHaveCount(1);

    const gpuNode = nodes
      .locator(`button[title="${NODE_NAME_GPU_SPOT}"]`)
      .locator('xpath=ancestor::*[@data-testid="topology-node"][1]');
    await gpuNode.getByTestId('expand-toggle').click();

    // Pod child is now visible with its name.
    const pods = page.getByTestId('topology-pod');
    await expect(
      pods.locator(`button[title="${POD_RUNNING_GPU_NAME}"]`),
    ).toHaveCount(1);
  });

  test('default NodePool expands to reveal default NodeClaim and Node', async ({ page }) => {
    await page.goto('/topology');

    const nodePools = page.getByTestId('topology-node-pool');
    const defaultPool = nodePools
      .locator(`button[title="${NODEPOOL_DEFAULT_NAME}"]`)
      .locator('xpath=ancestor::*[@data-testid="topology-node-pool"][1]');
    await defaultPool.getByTestId('expand-toggle').click();

    const claims = page.getByTestId('topology-node-claim');
    await expect(
      claims.locator(`button[title="${NODECLAIM_DEFAULT_NAME}"]`),
    ).toHaveCount(1);

    const defaultClaim = claims
      .locator(`button[title="${NODECLAIM_DEFAULT_NAME}"]`)
      .locator('xpath=ancestor::*[@data-testid="topology-node-claim"][1]');
    await defaultClaim.getByTestId('expand-toggle').click();

    const nodes = page.getByTestId('topology-node');
    // Only the default Node is rendered, since the gpu-spot claim is
    // still collapsed.
    await expect(nodes).toHaveCount(1);
    await expect(
      nodes.locator(`button[title="${NODE_NAME_DEFAULT}"]`),
    ).toHaveCount(1);

    // Running pod appears under its node.
    const defaultNode = nodes
      .locator(`button[title="${NODE_NAME_DEFAULT}"]`)
      .locator('xpath=ancestor::*[@data-testid="topology-node"][1]');
    await defaultNode.getByTestId('expand-toggle').click();

    const pods = page.getByTestId('topology-pod');
    await expect(
      pods.locator(`button[title="${POD_RUNNING_DEFAULT_NAME}"]`),
    ).toHaveCount(1);

    // Sanity: the basic fixture sanity check.
    expect(nodeFixtures.length).toBeGreaterThan(0);
  });

  test('pending pods page shows structured scheduling evidence', async ({ page }) => {
    await page.goto('/pending-pods');

    await expect(page.getByTestId('page-pending-pods')).toBeVisible();

    // The advanced pending pod must appear in the table.
    const detail = page.getByTestId('pending-pod-detail');
    // Open the detail panel by clicking the row label.
    await page
      .locator('.kv-list-page__event-row', { hasText: POD_PENDING_ADVANCED_NAME })
      .first()
      .click();

    await expect(detail).toBeVisible();
    await expect(detail).toContainText(POD_PENDING_ADVANCED_NAME);

    // The evidence grid shows counts.
    await expect(detail).toContainText('Affinity');
    await expect(detail).toContainText('Tolerations');
    await expect(detail).toContainText('Topology Constraints');
    await expect(detail).toContainText('Node Selectors');

    // Observed reasons list is rendered.
    await expect(page.getByTestId('pending-pod-reasons')).toBeVisible();
  });

  test('events page shows Karpenter-related events', async ({ page }) => {
    await page.goto('/events');
    await expect(page.getByTestId('page-events')).toBeVisible();

    // The fixture events reference a NodeClaim (Created) and a Pod
    // (Scheduled). Both reasons should be visible.
    await expect(
      page.locator('table').or(page.locator('[role="row"]')),
    ).toBeVisible();
    await expect(page.getByText('Created', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Scheduled', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(NODECLAIM_DEFAULT_NAME).first()).toBeVisible();
    await expect(page.getByText(POD_RUNNING_DEFAULT_NAME).first()).toBeVisible();
  });

  test('pending pod -> scheduled pod flow updates topology and removes from pending list', async ({
    page,
  }) => {
    // 1. Verify pending pod is currently listed and shown as Pending.
    await page.goto('/pending-pods');
    await expect(page.getByTestId('page-pending-pods')).toBeVisible();
    await page
      .locator('.kv-list-page__event-row', { hasText: POD_PENDING_ADVANCED_NAME })
      .first()
      .click();
    await expect(page.getByTestId('pending-pod-detail')).toContainText('Pending');

    // 2. Schedule the pending pod onto the gpu-spot Node by mutating
    //    the in-memory mock cluster via the test endpoint.
    const scheduled = {
      ...mockCluster,
      pods: mockCluster.pods.map((pod) =>
        pod.metadata?.name === POD_PENDING_ADVANCED_NAME
          ? {
              ...pod,
              spec: {
                ...(pod.spec ?? {}),
                nodeName: NODE_NAME_GPU_SPOT,
              },
              status: {
                ...(pod.status ?? {}),
                phase: 'Running',
                podIP: '10.0.21.42',
                hostIP: '10.0.2.77',
              },
            }
          : pod,
      ),
    };
    const ctx = await pwRequest.newContext({ baseURL: BACKEND_ORIGIN });
    const seedRes = await ctx.post('/api/_test/seed', { data: scheduled });
    expect(seedRes.ok()).toBeTruthy();

    const schedRes = await ctx.post('/api/_test/schedule', {
      data: {
        podName: POD_PENDING_ADVANCED_NAME,
        podNamespace: 'batch',
        nodeName: NODE_NAME_GPU_SPOT,
      },
    });
    expect(schedRes.ok()).toBeTruthy();
    await ctx.dispose();

    // 3. Topology should now show the previously-pending pod under
    //    the gpu-spot Node once we reload.
    await page.goto('/topology');
    await expect(page.getByTestId('topology-page')).toBeVisible();

    const nodePools = page.getByTestId('topology-node-pool');
    await nodePools
      .locator(`button[title="${NODEPOOL_GPU_SPOT_NAME}"]`)
      .locator('xpath=ancestor::*[@data-testid="topology-node-pool"][1]')
      .getByTestId('expand-toggle')
      .click();
    await page
      .getByTestId('topology-node-claim')
      .locator(`button[title="${NODECLAIM_GPU_SPOT_NAME}"]`)
      .locator('xpath=ancestor::*[@data-testid="topology-node-claim"][1]')
      .getByTestId('expand-toggle')
      .click();
    await page
      .getByTestId('topology-node')
      .locator(`button[title="${NODE_NAME_GPU_SPOT}"]`)
      .locator('xpath=ancestor::*[@data-testid="topology-node"][1]')
      .getByTestId('expand-toggle')
      .click();

    await expect(
      page
        .getByTestId('topology-pod')
        .locator(`button[title="${POD_PENDING_ADVANCED_NAME}"]`),
    ).toHaveCount(1);

    // 4. The pending pods page should no longer list the pod.
    await page.goto('/pending-pods');
    await expect(page.getByTestId('page-pending-pods')).toBeVisible();
    await expect(
      page.locator('.kv-list-page__event-row', {
        hasText: POD_PENDING_ADVANCED_NAME,
      }),
    ).toHaveCount(0);

    // Sanity: the basic fixture sanity check — pods count unchanged.
    expect(podFixtures.length).toBeGreaterThan(0);
  });
});
