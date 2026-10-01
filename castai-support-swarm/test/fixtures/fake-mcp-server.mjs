/**
 * Fake MCP server for unit tests — a REAL MCP server over stdio built with
 * @modelcontextprotocol/sdk. Registers exactly the 10 read-only CAST AI tool
 * names; each tool returns `{ tool: <name>, echo: <args> }` as a JSON text
 * content block.
 *
 * Optional env:
 *   FAKE_MCP_LOG — path to a file; each *called* tool name is appended as a
 *                  line, so tests can prove a round trip happened (or didn't).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { appendFileSync } from 'node:fs';

const TOOL_NAMES = [
  'list_clusters',
  'get_cluster_details',
  'get_cluster_savings',
  'get_cluster_cost',
  'get_cluster_nodes',
  'get_cluster_utilization',
  'get_workload_recommendations',
  'get_workload_autoscaler_status',
  'get_available_savings',
  'get_recent_optimization_actions',
];

const server = new Server(
  { name: 'fake-castai-mcp-server', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_NAMES.map((name) => ({
    name,
    description: `fake read-only tool ${name}`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: true },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (process.env.FAKE_MCP_LOG) {
    try { appendFileSync(process.env.FAKE_MCP_LOG, `${name}\n`); } catch { /* best effort */ }
  }
  if (!TOOL_NAMES.includes(name)) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `unknown tool: ${name}` }) }],
      isError: true,
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ tool: name, echo: args ?? {} }) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
