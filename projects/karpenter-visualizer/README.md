# Karpenter Visualizer

A read-only web visualizer for the [Karpenter](https://karpenter.sh/) object
graph running on an Amazon EKS cluster. It shows `NodePools`, `NodeClaims`,
`EC2NodeClasses`, `Nodes`, `Pods`, and `Events` plus a derived topology view
that links each `NodeClaim` to its `NodePool` and `EC2NodeClass`.

The visualizer is **strictly read-only**. It never creates, updates, or deletes
any Kubernetes object and the bundled RBAC enforces that at the cluster level.

---

## Table of contents

- [What it does](#what-it-does)
- [Architecture summary](#architecture-summary)
- [Prerequisites](#prerequisites)
- [Local development](#local-development)
- [Running against a real cluster](#running-against-a-real-cluster)
- [In-cluster deployment](#in-cluster-deployment)
- [RBAC summary](#rbac-summary)
- [Environment variables](#environment-variables)
- [Security notes](#security-notes)
- [Project layout](#project-layout)
- [Related docs](#related-docs)

For detailed run instructions (mock mode, local dev, real cluster, tests,
in-cluster deployment, and troubleshooting), see
[`docs/running.md`](docs/running.md).

---

## What it does

The Karpenter Visualizer answers questions like:

- Which `NodePools` exist and what are their limits, weights, and disruption policies?
- Which `NodeClaims` are pending, launching, or registered as Nodes?
- Which `EC2NodeClass` does each `NodePool` use, and what subnet/SG/AMI did Karpenter pick?
- Are there unschedulable (pending) pods that need a new `NodeClaim`?
- What is the recent event timeline for a node or pod?

All data is fetched live from the Kubernetes API server. The UI refreshes
periodically and renders the full object graph in a browser.

The full request and data flow is documented in
[`docs/architecture.md`](docs/architecture.md).

---

## Architecture summary

The project is a small two-tier application:

- **Backend** (`src/backend`): Node.js + Express service. Talks to the
  Kubernetes API server using the official `@kubernetes/client-node` library.
  Holds credentials (in-cluster service-account token or local kubeconfig).
- **Frontend** (`src/frontend`): React SPA built with Vite. Ships as static
  assets under `dist/frontend`. The backend serves those assets directly in
  production (`NODE_ENV=production`).

```
+----------------------+        HTTP/JSON        +----------------------+
|  Browser (SPA)       | <---------------------> |  Express backend     |
|  React + Vite        |   /api/healthz, ...     |  Node.js 20+         |
|  No credentials      |                         |  Holds kubeconfig or |
+----------------------+                         |  service-account tok.|
                                                +----------+-----------+
                                                           |
                                                   Kubernetes API
                                                  (read-only verbs)
                                                           |
                                                           v
                                                +----------------------+
                                                |  Karpenter CRDs +    |
                                                |  core resources      |
                                                +----------------------+
```

Key property: **the browser never sees Kubernetes credentials, tokens, or
secrets.** Every API call goes through the backend.

---

## Prerequisites

- **Node.js 20 or newer** (the backend uses native `fetch` and `node:url`).
- **npm 10+** (ships with Node 20).
- A real cluster is **not** required for local development — the backend can
  run against an in-memory mock (`MOCK_K8S=true`) or against your kubeconfig.
- Optional: `kubectl` for the in-cluster deployment steps and for pointing a
  local backend at a remote cluster.

---

## Local development

Clone the repository and install dependencies once:

```bash
git clone <repo-url> castai
cd castai/projects/karpenter-visualizer
npm install
```

### Run with the in-memory mock (no cluster required)

```bash
MOCK_K8S=true npm run dev
```

This starts the backend on `http://localhost:3001` and the Vite dev server on
`http://localhost:5173`. The frontend proxies `/api` requests to the backend.
In mock mode the backend serves seeded or empty data so you can develop the
UI without a real cluster.

### Run against your local kubeconfig

With a working `kubectl` context (e.g. via `aws eks update-kubeconfig ...`):

```bash
npm run dev
```

The backend loads `~/.kube/config` (or whatever `KUBECONFIG` points at) and
talks to the cluster. Your user must have at minimum `get/list/watch` on the
resources listed in the [RBAC summary](#rbac-summary).

### Run only one side

```bash
npm run dev:backend   # Express on :3001
npm run dev:frontend  # Vite on :5173
```

### Run tests

```bash
npm run test        # runs both backend and frontend unit suites
npm run test:api    # backend route + service tests (vitest)
npm run test:ui     # frontend component tests (vitest + jsdom)
npm run test:e2e    # Playwright end-to-end tests (requires `npx playwright install`)
```

---

## Running against a real cluster

Build a production bundle and start the server:

```bash
npm install
npm run build

# Option A: point at a kubeconfig file on disk
export KUBECONFIG=/path/to/kubeconfig.yaml
npm start
# -> backend listening on http://localhost:3001

# Option B: port-forward the backend to a cluster running the visualizer
kubectl -n karpenter-visualizer port-forward svc/karpenter-visualizer 3000:80
# then open http://localhost:3000
```

In production mode the backend serves the built frontend from
`dist/frontend`, so one process is enough.

If you do not have a kubeconfig, set `KUBECONFIG` to the absolute path of a
kubeconfig YAML, or place the kubeconfig at the default location
(`~/.kube/config`).

---

## In-cluster deployment

The Kubernetes manifests under [`k8s/`](k8s/) deploy the visualizer into a
fresh cluster.

### 1. Build and push the image

```bash
docker build -t karpenter-visualizer:latest .
docker push <registry>/karpenter-visualizer:latest
```

Edit `k8s/deployment.yaml` and change the `image:` field to your registry
path if you are not using a local registry.

### 2. Apply the manifests

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/serviceaccount.yaml
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# Or, if you use kustomize:
kubectl apply -k k8s/
```

### 3. Reach the UI

```bash
kubectl -n karpenter-visualizer port-forward svc/karpenter-visualizer 3000:80
# open http://localhost:3000
```

The Service is `ClusterIP` for safety — expose it with an Ingress of your
choice if you need external access. Do not change it to `LoadBalancer`
without an authentication layer in front, because the visualizer itself has
no built-in auth.

---

## RBAC summary

The cluster-level RBAC is intentionally minimal and read-only:

| API group           | Resources                       | Verbs                |
| ------------------- | ------------------------------- | -------------------- |
| `karpenter.sh`      | `nodepools`, `nodeclaims`       | `get`, `list`, `watch` |
| `karpenter.k8s.aws` | `ec2nodeclasses`                | `get`, `list`, `watch` |
| core (`""`)         | `nodes`, `pods`, `events`       | `get`, `list`, `watch` |

The full manifest is in [`k8s/rbac.yaml`](k8s/rbac.yaml). It defines a
`ClusterRole` named `karpenter-visualizer-read-only` and binds it to the
`karpenter-visualizer` ServiceAccount in the `karpenter-visualizer` namespace.

**Why no ConfigMap, Secret, or write permissions?**

- The visualizer is fully configured through environment variables and the
  service-account token. No cluster-side configuration objects are needed.
- No write verbs are granted, so even if the visualizer were compromised it
  could not mutate any cluster state. This is the project's threat model.

If you want a separate `ConfigMap` later (for example to externalize the
cluster name shown in the header), add a new manifest under `k8s/` rather
than expanding `rbac.yaml` — keeping the RBAC surface as small as possible
is a deliberate security choice.

---

## Environment variables

| Variable             | Default       | Description                                                                                       |
| -------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `PORT`               | `3001`        | TCP port the Express server binds to. The deployment manifest sets `3000` to match the Service.   |
| `NODE_ENV`           | `development` | When set to `production`, the server also serves `dist/frontend` as static assets.                |
| `FRONTEND_DIST_DIR`  | `dist/frontend` | Path (relative to CWD) of the built frontend assets. Only used in production.                   |
| `MOCK_K8S`           | _(unset)_     | When set to `true`, `1`, or `yes`, the backend uses an in-memory client instead of the real API. |
| `KUBECONFIG`         | `~/.kube/config` | Path to a kubeconfig file for local development. Ignored when running in-cluster.              |

The backend never reads credentials from environment variables — the
service-account token (in-cluster) or kubeconfig file (local) is the only
source of cluster credentials, and it never leaves the backend.

---

## Security notes

- **Read-only everywhere.** The RBAC grants only `get/list/watch`. The
  Kubernetes client in `src/backend/k8s/client.ts` has no helper for
  mutating verbs. Any attempt to add `create/update/patch/delete` would be
  a deliberate, reviewable change.
- **No secrets in the browser.** The frontend has no kubeconfig, no
  service-account token, and no AWS credentials. It only talks to the
  backend over HTTP/JSON.
- **No secrets in git.** The repo's `.gitignore` excludes `.env`,
  `kubeconfig`, `*.pem`, `*.key`, and similar. Verify with
  `git status` and `git ls-files` before publishing.
- **Image runs as non-root.** The Deployment sets `runAsNonRoot: true`,
  `readOnlyRootFilesystem: true`, drops all Linux capabilities, and runs as a
  non-root UID.
- **Probes are safe.** Liveness and readiness probe the same in-process
  `/api/healthz` endpoint; no external URL is contacted.

If you find a security issue, please open a private issue or contact the
maintainers — do not post details publicly.

---

## Project layout

```
projects/karpenter-visualizer/
├── index.html
├── package.json
├── playwright.config.ts
├── tsconfig*.json
├── vite.config.ts
├── vitest*.config.ts
├── src/
│   ├── backend/             # Express server, routes, K8s client, services
│   ├── frontend/            # React SPA (pages, components, hooks, CSS)
│   └── shared/              # Types shared by backend and frontend
├── test/
│   ├── backend/             # vitest API tests
│   ├── frontend/            # vitest UI tests
│   ├── e2e/                 # Playwright E2E tests
│   └── fixtures/            # Mock cluster fixtures
├── k8s/                     # Kubernetes manifests (read-only RBAC, Deployment, Service)
└── docs/
    └── architecture.md
```

---

## Related docs

- [Architecture & API surface](docs/architecture.md)
- [Kubernetes manifests](k8s/)

---

## License

See repository root for license information.
