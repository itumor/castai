/**
 * Watch / informer helper.
 *
 * READ-ONLY: this module only sets up watches (HTTP long-polling or
 * informers) against the Kubernetes API. It MUST NOT issue any mutating
 * verb.
 *
 * The MVP does not require persistent watches — the routes are request /
 * response and re-list on demand. This module provides the primitives
 * (`watchResources`, `stopWatcher`) for future SSE / push endpoints
 * (e.g. streaming events to the browser).
 */

import { KubeConfig, Watch } from '@kubernetes/client-node';

export interface WatchHandle {
  /** Aborts the underlying watch request. */
  abort: () => void;
}

export type WatchEventKind = 'ADDED' | 'MODIFIED' | 'DELETED';

export interface WatchEvent<T = unknown> {
  type: WatchEventKind;
  object: T;
}

export type WatchedResource =
  | 'nodes'
  | 'pods'
  | 'events'
  | 'nodepools'
  | 'nodeclaims'
  | 'ec2nodeclasses';

/**
 * Wire-format watcher. Uses the `@kubernetes/client-node` `Watch` helper
 * (HTTP/1.1 chunked JSON stream) so it works for short-lived SSE-style
 * streams.
 *
 * For the MVP the routes do not call this — but it's exported so future
 * steps (e.g. an SSE endpoint streaming events) can plug it in.
 */
export async function watchResources(
  kubeconfig: KubeConfig,
  resource: WatchedResource,
  onEvent: (ev: WatchEvent) => void,
  signal?: AbortSignal,
): Promise<WatchHandle> {
  const watcher = new Watch(kubeconfig);
  const path = resourcePath(resource);
  let active = true;

  watcher
    .watch(
      path,
      {},
      (phase: string, apiObj: unknown) => {
        if (!active) return;
        onEvent({ type: phase as WatchEventKind, object: apiObj });
      },
      (err: unknown) => {
        if (!active) return;
        // eslint-disable-next-line no-console
        console.error('[watch] error:', err);
      },
    )
    .catch((err: unknown) => {
      if (!active) return;
      // eslint-disable-next-line no-console
      console.error('[watch] failed to start:', err);
    });

  const abort = () => {
    active = false;
  };
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  return { abort };
}

export function stopWatcher(handle: WatchHandle): void {
  handle.abort();
}

function resourcePath(resource: WatchedResource): string {
  switch (resource) {
    case 'nodes':
      return '/api/v1/nodes';
    case 'pods':
      return '/api/v1/pods';
    case 'events':
      return '/api/v1/events';
    case 'nodepools':
      return '/apis/karpenter.sh/v1/nodepools';
    case 'nodeclaims':
      return '/apis/karpenter.sh/v1/nodeclaims';
    case 'ec2nodeclasses':
      return '/apis/karpenter.k8s.aws/v1/ec2nodeclasses';
    default:
      throw new Error(`unknown resource for watch: ${resource}`);
  }
}
