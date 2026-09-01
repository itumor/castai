import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import App from '../../src/frontend/App';

describe('<App /> routing smoke test', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    // Stub fetch so the app's downstream API calls (made by useApi consumers) don't throw.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.unstubAllGlobals();
  });

  it('mounts and renders the shared layout', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    const layoutEl = container.querySelector('[data-testid="kv-layout"]');
    expect(layoutEl).not.toBeNull();
    expect(layoutEl).toBeInstanceOf(HTMLElement);
    expect(layoutEl?.tagName).toBe('DIV');
  });
});
