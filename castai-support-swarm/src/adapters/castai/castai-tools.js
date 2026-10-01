/**
 * CastaiTools adapter interface (read-only CAST AI MCP tools).
 *
 * @interface CastaiTools
 * @description Any CAST AI adapter used by agents must expose exactly one method:
 *
 *   call(toolName, args) → Promise<object>
 *
 *   - `toolName` must be one of READ_ONLY_TOOL_NAMES.
 *   - `args` is a plain object of tool arguments (e.g. { clusterId }).
 *   - Resolves with the tool's JSON result; rejects on transport or
 *     permission errors.
 *
 * Implementations:
 *   - src/adapters/castai/mock-castai-tools.js  (fixture-backed, for tests/evals)
 *   - src/adapters/castai/mcp-castai-tools.js   (real MCP subprocess client)
 */

/**
 * Frozen list of the 10 read-only CAST AI MCP tool names.
 * Must match castai-mcp-server/src/tools/index.js exactly.
 * Any other tool name must be rejected at the interface level.
 *
 * @type {string[]}
 */
export const READ_ONLY_TOOL_NAMES = Object.freeze([
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
]);

/**
 * Thrown when a caller requests a tool name outside READ_ONLY_TOOL_NAMES.
 * Shared by every CastaiTools implementation so guards behave uniformly.
 */
export class ToolNotAllowedError extends Error {
  /**
   * @param {string} toolName the rejected tool name
   */
  constructor(toolName) {
    super(`Tool not allowed (read-only CastaiTools): ${toolName}`);
    this.name = 'ToolNotAllowedError';
    this.toolName = toolName;
  }
}
