# Running the Karpenter Visualizer

This guide covers all the ways to run the visualizer, from local development to a production EKS deployment. The application is read-only and never modifies the cluster.

---

## Table of contents

- [Quick start (mock mode)](#quick-start-mock-mode)
- [Local development](#local-development)
- [Run against a real cluster](#run-against-a-real-cluster)
- [Build and run the production bundle](#build-and-run-the-production-bundle)
- [Run the test suites](#run-the-test-suites)
- [Deploy in-cluster](#deploy-in-cluster)
- [Troubleshooting](#troubleshooting)

---

## Quick start (mock mode)

The fastest way to see the UI is to run the backend with the built-in mock cluster. No kubeconfig or real cluster is required.

```bash
cd projects/karpenter-visualizer
npm install
MOCK_K8S=true npm run dev
```

This starts:

- Express backend on `http://localhost:3001`
- Vite dev server on `http://localhost:5173` with a proxy to the backend
- A fixture cluster with NodePools, NodeClaims, Nodes, Pods, and Events

Open `http://localhost:5173` in a browser. Use the **Topology** page to expand
`NodePool → NodeClaim → Node → Pod`, or the **Pending Pods** page to see
scheduling evidence.

To stop, press `Ctrl-C` once (the `concurrently` wrapper terminates both
processes).

---

## Local development

```bash
cd projects/karpenter-visualizer
npm install
npm run dev
```

What happens:

- `tsx watch` runs the backend and reloads on TypeScript changes.
- Vite runs the React frontend with hot-module replacement.
- API requests from the frontend are proxied to the backend.

If the backend has `MOCK_K8S=true`, it serves fixture data. If a valid
`KUBECONFIG` (or default kubeconfig) exists, the backend connects to a real
cluster instead.

Useful scripts:

```bash
npm run build:backend    # Compile backend TypeScript to dist/backend
npm run build:frontend   # Build production frontend to dist/frontend
npm run build            # Build both
npm start                # Run the compiled backend (serves dist/frontend)
```

---

## Run against a real cluster

1. Make sure `kubectl` works and `KUBECONFIG` points to the cluster:

   ```bash
   export KUBECONFIG=/path/to/kubeconfig
   kubectl get nodes
   ```

2. Install the read-only RBAC manifests so the visualizer can list/watch/get
   resources:

   ```bash
   kubectl apply -f k8s/namespace.yaml
   kubectl apply -f k8s/serviceaccount.yaml
   kubectl apply -f k8s/rbac.yaml
   ```

3. Build and start the backend:

   ```bash
   npm run build
   npm start
   ```

   The backend picks up `KUBECONFIG` automatically via
   `@kubernetes/client-node`.

4. Open `http://localhost:3000`.

If you prefer not to use a service account locally, omit the `k8s/*`
application and run the backend under your own user credentials. The RBAC
manifests are primarily for in-cluster deployment.

---

## Build and run the production bundle

```bash
cd projects/karpenter-visualizer
npm ci
npm run build
npm start
```

- `npm run build` compiles the backend and creates a static frontend bundle in
  `dist/frontend`.
- `npm start` runs `dist/backend/server.js`, which serves the API and the
  static frontend from the same port (default `3000`).

You can override the port:

```bash
PORT=8080 npm start
```

---

## Run the test suites

The project has three test targets:

```bash
# Backend API tests (Supertest + Vitest)
npm run test:api

# Frontend unit tests (Vitest + jsdom)
npm run test:ui

# Playwright E2E tests against a real browser (uses MOCK_K8S=true)
npm run test:e2e

# Convenience alias: runs test:api + test:ui
npm test
```

E2E tests require Playwright Chromium. If not installed, the first run will
prompt you; install it with:

```bash
npx playwright install chromium
```

All tests can run offline (the E2E harness starts its own backend and frontend
with `MOCK_K8S=true`).

---

## Deploy in-cluster

Build a container image and apply the manifests:

```bash
cd projects/karpenter-visualizer
# Build an image and push it to a registry your cluster can reach.
docker build -t <registry>/karpenter-visualizer:latest .
docker push <registry>/karpenter-visualizer:latest
```

Update the image in `k8s/deployment.yaml`, then apply everything:

```bash
kubectl apply -k k8s/
```

This deploys:

- Namespace `karpenter-visualizer`
- ServiceAccount `karpenter-visualizer`
- Read-only ClusterRole and ClusterRoleBinding
- Deployment with a hardened pod security context
- ClusterIP Service

Port-forward to access it:

```bash
kubectl -n karpenter-visualizer port-forward svc/karpenter-visualizer 8080:80
```

Then open `http://localhost:8080`.

### Using Kustomize directly

```bash
kubectl kustomize k8s/   # render manifests to stdout
kubectl apply -k k8s/    # apply them
```

---

## Troubleshooting

### Backend fails to connect to the cluster

- Verify `KUBECONFIG` is set and `kubectl get nodes` works.
- If running in-cluster, confirm the ServiceAccount token is mounted and the
  RBAC manifests were applied.
- Check the backend logs for `403 Forbidden` — that usually means missing RBAC
  permissions.

### Frontend shows a blank page

- Check the browser console for API errors.
- Confirm the backend is reachable from the frontend origin.
- If you changed `PORT`, make sure the frontend proxy/dev-server points to the
  same port.

### Tests time out

- E2E tests start their own servers on ports `3101` and `5103`. Make sure those
  ports are free.
- If Playwright cannot find Chromium, run `npx playwright install chromium`.

### MOCKS not working

- `MOCK_K8S=true` must be set for the backend process. `npm run dev` does not
  enable it by default; run `MOCK_K8S=true npm run dev` for mock mode.
