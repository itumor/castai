# castai-mcp-server

Local Node.js Model Context Protocol (MCP) server that exposes **read-only**
CAST AI tools for the Siemens EU organization. It speaks MCP JSON-RPC over
stdio (and can be wrapped for HTTP), and is consumed by Kimchi and OpenCode
as an MCP client. The server wraps the CAST AI REST API at
`https://api.eu.cast.ai/` and is designed so that an LLM agent can never
hold or issue write-class credentials.

## Security model

The server is built around three defensive layers:

- **Read-only by default.** All currently registered tools (`list_clusters`,
  `get_cluster_details`, `get_cluster_savings`, `get_cluster_cost`,
  `get_cluster_nodes`, `get_cluster_utilization`,
  `get_workload_recommendations`, `get_workload_autoscaler_status`,
  `get_available_savings`, `get_recent_optimization_actions`) issue only
  `GET` against `api.eu.cast.ai`. Any non-`GET` call is rejected by the
  policy gate unless `APPROVAL_MODE=approve` is set and a valid approval
  token is presented. The HTTP client itself refuses to send `POST`,
  `PUT`, `PATCH`, or `DELETE`.
- **Approval gate for writes.** A single example mutating tool,
  `delete_cluster`, is shipped to exercise the gate end-to-end. To call
  it you must (1) start the server with `APPROVAL_MODE=approve`, (2) call
  the `approve_operation` meta-tool to mint a one-time, 5-minute token,
  and (3) invoke the mutating tool via the `invoke_approved_operation`
  meta-tool, passing that token.
- **Credential redaction.** The CAST AI API key lives only in the server's
  `process.env`. Every log line and every tool result is run through a
  redactor that scrubs `castai_v1_*` tokens, `Authorization:` /
  `X-API-Key` headers, and any JSON field named `apiKey`, `api_key`,
  `token`, `password`, `secret`, etc., before the value is sent to the
  LLM. Logs go to stderr; stdout is reserved for MCP frames.

See `.kimchi/docs/castai-mcp-architecture.md` and
`.kimchi/docs/castai-mcp-security.md` for the full design.

## Setup

1. Copy the example environment file and fill in your credentials:

   ```sh
   cd castai-mcp-server
   cp .env-example .env
   ```

2. Create a **read-only** CAST AI API key for the Siemens org:

   - Sign in to <https://console.cast.ai/>.
   - Go to **Settings -> API keys** for the target organization.
   - Create a new key with the minimum read scopes listed in
     `.kimchi/docs/castai-mcp-security.md` §2
     (`organizations:read`, `kubernetes/external-clusters:read`,
     `inventory:read`, `recommendations:read`). Do **not** grant any
     write, admin, billing, or cluster-connect scopes.
   - Set an expiry (90 days) and a label such as `kimchi-mcp-readonly`.

3. Put the key into `.env`:

   ```env
   CASTAI_API_KEY=castai_v1_...
   CASTAI_API_BASE=https://api.eu.cast.ai
   CASTAI_ORG_ID=<your siemens org uuid>
   LOG_LEVEL=info
   APPROVAL_MODE=block
   ```

   `CASTAI_ORG_ID` is optional but recommended; when set, every request is
   bound to that org. `APPROVAL_MODE=block` (default) refuses any
   write-class call; switch to `approve` only if you have intentionally
   provisioned a key with write scopes.

## Usage

Install dependencies and start the server over stdio:

```sh
npm install
npm start
```

The server prints `[info] connected via stdio` to stderr and then waits
for MCP JSON-RPC frames on stdin. It is intended to be spawned by the
MCP client (Kimchi / OpenCode) and not run interactively.

To wire it up in a client, point the client at
`src/server.js` with `node` as the command. See the
[`.kimchi/mcp-config.json`](../../.kimchi/mcp-config.json) example below
in this repo.

## Example queries

The following prompts work once the server is connected to Kimchi or
OpenCode. Replace `<id>` with the actual CAST AI cluster UUID.

- **List all CAST AI clusters visible to my org.**

  > Use the CAST AI MCP server to call `list_clusters` and show me every
  > cluster visible to the bound organization, sorted by name.

- **Show me the savings for cluster `<id>`.**

  > Ask the CAST AI MCP server for `get_cluster_savings` on cluster
  > `<id>` and summarize the cumulative savings to date.

- **Get recent optimization actions.**

  > Use `get_recent_optimization_actions` (no arguments) to fetch the
  > most recent 50 optimization actions across our org. Group them by
  > action type and call out anything unusual.

- **What workload recommendations exist for cluster `<id>`?**

  > Call `get_workload_recommendations` for cluster `<id>` and list the
  > top five right-sizing or consolidation recommendations, including
  > the estimated monthly savings for each.

- **Approve and delete cluster `<id>`.** *(requires `APPROVAL_MODE=approve`)*

  > 1. Stop the server and restart it with `APPROVAL_MODE=approve` set
  >    in `.env`.
  > 2. Call the meta-tool `approve_operation` with
  >    `toolName="delete_cluster"`, `method="DELETE"`,
  >    `path="/v1/kubernetes/clusters/<id>"`. The server returns a
  >    single-use, 5-minute `token`.
  > 3. Call `invoke_approved_operation` with the same `toolName`,
  >    `method`, `path`, the returned `token`, and `clusterId=<id>`.
  >
  > The HTTP client will still refuse to send a `DELETE` to
  > `api.eu.cast.ai` — this is a defence-in-depth check. To actually
  > perform the deletion you would also need to provision a key with
  > `kubernetes/clusters:write`; this is **not** the recommended default
  > for Siemens.

## Local testing

Run the unit-test suite:

```sh
npm test
```

The suite uses Mocha and covers the policy gate, the HTTP client, the
redactor, the approval gate, the server wiring, and the tool registry.

## End-to-end test (stdio)

The fastest way to drive the running server by hand is the MCP
Inspector:

```sh
# 1. make sure .env has a valid CASTAI_API_KEY
# 2. launch the inspector against the local entry point
npx @modelcontextprotocol/inspector node src/server.js
```

In the Inspector UI:

1. Pick **stdio** as the transport (it should be selected automatically).
2. Click **Connect**, then **List Tools** to confirm the tool registry.
3. Click any tool, fill in its arguments (e.g. `clusterId`), and click
   **Call Tool** to see the redacted JSON response.

Alternatively, send raw JSON-RPC frames over stdio with `mcp-cli` or a
simple shell pipeline. The server reads MCP frames from stdin and writes
them to stdout; logs go to stderr.

```sh
# List tools
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | node src/server.js 2>/dev/null

# Call list_clusters
printf '%s\n' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_clusters","arguments":{}}}' \
  | node src/server.js 2>/dev/null
```

(`npm install` is still required for either approach; the entry point
imports `@modelcontextprotocol/sdk` from `node_modules`.)

## Docker usage

Build and run the server in a container. The image is based on
`node:20-slim`, installs only production dependencies, and runs the
stdio entry point.

```sh
# build
docker build -t castai-mcp-server:dev castai-mcp-server

# run (reads API key, org id, etc. from castai-mcp-server/.env)
docker compose --file castai-mcp-server/docker-compose.yml run --rm castai-mcp-server
```

`docker-compose.yml` mounts the host `.env` into the container so the
server can read it at startup; no other volumes are required because the
server is stateless. The container exposes only its stdio streams, so it
must be invoked from an MCP client that knows how to attach to a
container (for example, by piping to `docker exec` or by running the
client and the container in the same pod).

If you prefer to pass the API key directly:

```sh
docker run --rm -i \
  -e CASTAI_API_KEY="$CASTAI_API_KEY" \
  -e CASTAI_API_BASE=https://api.eu.cast.ai \
  -e CASTAI_ORG_ID="$CASTAI_ORG_ID" \
  -e LOG_LEVEL=info \
  -e APPROVAL_MODE=block \
  castai-mcp-server:dev
```
