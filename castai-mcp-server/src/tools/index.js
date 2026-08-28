// Tool registry for the CAST AI MCP server.
//
// Each entry is a tool definition consumed by the MCP `tools/list`
// response and matched by the MCP `tools/call` handler. Schemas here
// are JSON Schema (the shape the MCP spec requires for inputSchema).
//
// The `mutating` flag is reserved for the read-only policy gate in
// server.js. Every tool shipped in step 2 is read-only; future write
// tools will set it to true and be rejected by `enforceReadOnly`
// unless APPROVAL_MODE=approve is set.
//
// Each tool also has a `handler(args, ctx)` async function. Handlers
// receive the parsed tool arguments and a context object that carries
// the CastaiClient instance. They return the MCP-shaped result
// ({ content: [{ type: 'text', text }] }) or, on error, the
// { isError: true, content: [...] } variant. Error messages are
// sanitized so API keys never leak into tool output.

const READ_ONLY_PROPS = {
  type: 'object',
  additionalProperties: false
};

// ---------- response shaping helpers ----------

function formatSuccess(data) {
  let text;
  try {
    text = JSON.stringify(data, null, 2);
  } catch (_) {
    text = String(data);
  }
  return { content: [{ type: 'text', text }] };
}

// Strip anything that smells like a credential before we hand the
// error message back to the model. We keep the URL, method, and
// status (useful for debugging) but never the response body, which
// may contain Authorization headers echoed by misconfigured proxies.
function formatError(err) {
  const safe = redactErrorMessage(err && err.message ? err.message : String(err));
  return {
    isError: true,
    content: [{ type: 'text', text: safe }]
  };
}

// Sensitive key names whose string values must be masked in JSON-ish
// payloads. Comparison is case-insensitive.
const SENSITIVE_KEYS = new Set([
  'apikey',
  'api_key',
  'api-key',
  'token',
  'accesstoken',
  'access_token',
  'access-token',
  'authtoken',
  'auth_token',
  'auth-token',
  'password',
  'secret',
  'clientsecret',
  'client_secret',
  'client-secret'
]);

function redactJsonStringValues(value) {
  if (typeof value === 'string') {
    // Try to parse the string as JSON; if it is a JSON object, walk
    // its keys and mask sensitive values.
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return JSON.stringify(redactJsonStringValues(parsed));
      } catch (_) {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactJsonStringValues(v));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(String(k).toLowerCase()) && typeof v === 'string') {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactJsonStringValues(v);
      }
    }
    return out;
  }
  return value;
}

function redactErrorMessage(msg) {
  if (msg == null) return msg;
  let s = String(msg);
  s = s.replace(/Authorization:\s*Token\s+[A-Za-z0-9._\-\[\]]+/gi, 'Authorization: Token [REDACTED]');
  s = s.replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._\-\[\]]+/gi, 'Authorization: Bearer [REDACTED]');
  s = s.replace(/X-API-Key[\s:]+[A-Za-z0-9._\-\[\]]+/gi, 'X-API-Key: [REDACTED]');
  s = s.replace(/Token\s+[A-Za-z0-9._\-\[\]]+/g, 'Token [REDACTED]');
  s = s.replace(/Bearer\s+[A-Za-z0-9._\-\[\]]+/g, 'Bearer [REDACTED]');
  s = s.replace(/castai_v1_[A-Za-z0-9._\-\[\]]+/g, 'castai_v1_[REDACTED]');
  s = s.replace(/\bapi[_-]?key[\s]*[=:][\s]*[A-Za-z0-9._\-\[\]]+/gi, 'api_key=[REDACTED]');
  // Mask JSON-shaped secrets embedded inside the message body.
  const redacted = redactJsonStringValues(s);
  if (typeof redacted === 'string') return redacted;
  try {
    return JSON.stringify(redacted);
  } catch (_) {
    return s;
  }
}

// ---------- tool definitions + handlers ----------

export const toolDefinitions = {
  list_clusters: {
    name: 'list_clusters',
    description:
      'List Kubernetes clusters visible to the bound CAST AI organization.',
    mutating: false,
    method: 'GET',
    pathTemplate: '/v1/kubernetes/clusters',
    inputSchema: {
      ...READ_ONLY_PROPS,
      properties: {}
    },
    handler: async (_args, { client }) => {
      try {
        const data = await client.get('/v1/kubernetes/clusters');
        return formatSuccess(data);
      } catch (err) {
        return formatError(err);
      }
    }
  },

  get_cluster_details: {
    name: 'get_cluster_details',
    description:
      'Get detailed information about a specific CAST AI Kubernetes cluster.',
    mutating: false,
    method: 'GET',
    pathTemplate: '/v1/kubernetes/clusters/{clusterId}',
    inputSchema: {
      ...READ_ONLY_PROPS,
      properties: {
        clusterId: {
          type: 'string',
          description: 'CAST AI cluster ID (UUID).'
        }
      },
      required: ['clusterId']
    },
    handler: async (args, { client }) => {
      try {
        const { clusterId } = args || {};
        if (!clusterId) {
          return formatError(new Error('clusterId is required'));
        }
        const data = await client.get(
          `/v1/kubernetes/clusters/${encodeURIComponent(clusterId)}`
        );
        return formatSuccess(data);
      } catch (err) {
        return formatError(err);
      }
    }
  },

  get_cluster_savings: {
    name: 'get_cluster_savings',
    description:
      'Get cumulative cost savings reported by CAST AI for a specific cluster.',
    mutating: false,
    method: 'GET',
    pathTemplate: '/v1/kubernetes/clusters/{clusterId}/savings',
    inputSchema: {
      ...READ_ONLY_PROPS,
      properties: {
        clusterId: {
          type: 'string',
          description: 'CAST AI cluster ID (UUID).'
        }
      },
      required: ['clusterId']
    },
    handler: async (args, { client }) => {
      try {
        const { clusterId } = args || {};
        if (!clusterId) {
          return formatError(new Error('clusterId is required'));
        }
        const data = await client.get(
          `/v1/kubernetes/clusters/${encodeURIComponent(clusterId)}/savings`
        );
        return formatSuccess(data);
      } catch (err) {
        return formatError(err);
      }
    }
  },

  get_cluster_cost: {
    name: 'get_cluster_cost',
    description:
      'Get recent cost / spend breakdown reported by CAST AI for a specific cluster.',
    mutating: false,
    method: 'GET',
    pathTemplate: '/v1/cost-management/clusters/{clusterId}/cost',
    inputSchema: {
      ...READ_ONLY_PROPS,
      properties: {
        clusterId: {
          type: 'string',
          description: 'CAST AI cluster ID (UUID).'
        },
        range: {
          type: 'string',
          enum: ['24h', '7d', '30d'],
          description: 'Time range for the cost aggregation. Defaults to 7d.'
        }
      },
      required: ['clusterId']
    },
    handler: async (args, { client }) => {
      try {
        const { clusterId, range } = args || {};
        if (!clusterId) {
          return formatError(new Error('clusterId is required'));
        }
        const data = await client.get(
          `/v1/cost-management/clusters/${encodeURIComponent(clusterId)}/cost`,
          { query: { range: range || '7d' } }
        );
        return formatSuccess(data);
      } catch (err) {
        return formatError(err);
      }
    }
  },

  get_cluster_nodes: {
    name: 'get_cluster_nodes',
    description:
      'List the worker nodes tracked by CAST AI for a specific cluster.',
    mutating: false,
    method: 'GET',
    pathTemplate: '/v1/kubernetes/clusters/{clusterId}/nodes',
    inputSchema: {
      ...READ_ONLY_PROPS,
      properties: {
        clusterId: {
          type: 'string',
          description: 'CAST AI cluster ID (UUID).'
        }
      },
      required: ['clusterId']
    },
    handler: async (args, { client }) => {
      try {
        const { clusterId } = args || {};
        if (!clusterId) {
          return formatError(new Error('clusterId is required'));
        }
        const data = await client.get(
          `/v1/kubernetes/clusters/${encodeURIComponent(clusterId)}/nodes`
        );
        return formatSuccess(data);
      } catch (err) {
        return formatError(err);
      }
    }
  },

  get_cluster_utilization: {
    name: 'get_cluster_utilization',
    description:
      'Get CPU / memory utilization statistics for a specific cluster.',
    mutating: false,
    method: 'GET',
    pathTemplate: '/v1/kubernetes/clusters/{clusterId}/utilization',
    inputSchema: {
      ...READ_ONLY_PROPS,
      properties: {
        clusterId: {
          type: 'string',
          description: 'CAST AI cluster ID (UUID).'
        }
      },
      required: ['clusterId']
    },
    handler: async (args, { client }) => {
      try {
        const { clusterId } = args || {};
        if (!clusterId) {
          return formatError(new Error('clusterId is required'));
        }
        const data = await client.get(
          `/v1/kubernetes/clusters/${encodeURIComponent(clusterId)}/utilization`
        );
        return formatSuccess(data);
      } catch (err) {
        return formatError(err);
      }
    }
  },

  get_workload_recommendations: {
    name: 'get_workload_recommendations',
    description:
      'Get workload right-sizing and consolidation recommendations for a specific cluster.',
    mutating: false,
    method: 'GET',
    pathTemplate: '/v1/kubernetes/clusters/{clusterId}/workload-recommendations',
    inputSchema: {
      ...READ_ONLY_PROPS,
      properties: {
        clusterId: {
          type: 'string',
          description: 'CAST AI cluster ID (UUID).'
        }
      },
      required: ['clusterId']
    },
    handler: async (args, { client }) => {
      try {
        const { clusterId } = args || {};
        if (!clusterId) {
          return formatError(new Error('clusterId is required'));
        }
        const data = await client.get(
          `/v1/kubernetes/clusters/${encodeURIComponent(clusterId)}/workload-recommendations`
        );
        return formatSuccess(data);
      } catch (err) {
        return formatError(err);
      }
    }
  },

  get_workload_autoscaler_status: {
    name: 'get_workload_autoscaler_status',
    description:
      'Get the current status of CAST AI workload autoscaler for a specific cluster.',
    mutating: false,
    method: 'GET',
    pathTemplate: '/v1/kubernetes/clusters/{clusterId}/autoscaler',
    inputSchema: {
      ...READ_ONLY_PROPS,
      properties: {
        clusterId: {
          type: 'string',
          description: 'CAST AI cluster ID (UUID).'
        }
      },
      required: ['clusterId']
    },
    handler: async (args, { client }) => {
      try {
        const { clusterId } = args || {};
        if (!clusterId) {
          return formatError(new Error('clusterId is required'));
        }
        const data = await client.get(
          `/v1/kubernetes/clusters/${encodeURIComponent(clusterId)}/autoscaler`
        );
        return formatSuccess(data);
      } catch (err) {
        return formatError(err);
      }
    }
  },

  get_available_savings: {
    name: 'get_available_savings',
    description:
      'Get the current estimated savings opportunity across clusters visible to the bound org.',
    mutating: false,
    method: 'GET',
    pathTemplate: '/v1/savings',
    inputSchema: {
      ...READ_ONLY_PROPS,
      properties: {}
    },
    handler: async (_args, { client }) => {
      try {
        const data = await client.get('/v1/savings');
        return formatSuccess(data);
      } catch (err) {
        return formatError(err);
      }
    }
  },

  get_recent_optimization_actions: {
    name: 'get_recent_optimization_actions',
    description:
      'Get the recent optimization actions (rebalances, spot migrations, etc.) executed by CAST AI.',
    mutating: false,
    method: 'GET',
    pathTemplate:
      '/v1/kubernetes/clusters/{clusterId}/actions OR /v1/kubernetes/actions',
    inputSchema: {
      ...READ_ONLY_PROPS,
      properties: {
        clusterId: {
          type: 'string',
          description:
            'Optional CAST AI cluster ID (UUID). If omitted, returns actions across the bound org.'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description: 'Maximum number of actions to return. Defaults to 50.'
        }
      }
    },
    handler: async (args, { client }) => {
      try {
        const { clusterId, limit } = args || {};
        const query = { limit: limit == null ? 50 : limit };
        const path = clusterId
          ? `/v1/kubernetes/clusters/${encodeURIComponent(clusterId)}/actions`
          : '/v1/kubernetes/actions';
        const data = await client.get(path, { query });
        return formatSuccess(data);
      } catch (err) {
        return formatError(err);
      }
    }
  },

  // ---------- mutating example + approval meta tools ----------

  delete_cluster: {
    name: 'delete_cluster',
    description:
      'Delete a CAST AI Kubernetes cluster registration. Mutating; requires approval.',
    mutating: true,
    method: 'DELETE',
    pathTemplate: '/v1/kubernetes/clusters/{clusterId}',
    inputSchema: {
      ...READ_ONLY_PROPS,
      properties: {
        clusterId: {
          type: 'string',
          description: 'CAST AI cluster ID (UUID).'
        }
      },
      required: ['clusterId']
    },
    // The HTTP client rejects DELETE at the wire level, so this handler
    // only exists to drive the approval gate end-to-end. In `allow`
    // mode the gate permits it and the client raises a typed error
    // describing the read-only defence-in-depth check.
    handler: async (args, { client }) => {
      try {
        const { clusterId } = args || {};
        if (!clusterId) {
          return formatError(new Error('clusterId is required'));
        }
        const data = await client.delete(
          `/v1/kubernetes/clusters/${encodeURIComponent(clusterId)}`
        );
        return formatSuccess(data);
      } catch (err) {
        return formatError(err);
      }
    }
  },

  approve_operation: {
    name: 'approve_operation',
    description:
      'Meta-tool: issue an approval token for a mutating CAST AI operation. Does not call the upstream API.',
    mutating: false,
    method: null,
    pathTemplate: null,
    inputSchema: {
      ...READ_ONLY_PROPS,
      properties: {
        toolName: {
          type: 'string',
          description: 'Name of the mutating tool being approved.'
        },
        method: {
          type: 'string',
          description: 'HTTP method (e.g. POST, PUT, DELETE).'
        },
        path: {
          type: 'string',
          description: 'Upstream path the token will unlock.'
        }
      },
      required: ['toolName', 'method', 'path']
    },
    // Handled directly by server.js so it can call ApprovalGate.approve.
    handler: async () => formatError(new Error('approve_operation is handled by the server dispatcher'))
  },

  invoke_approved_operation: {
    name: 'invoke_approved_operation',
    description:
      'Meta-tool: invoke a previously approved mutating operation. Does not call the upstream API itself.',
    mutating: false,
    method: null,
    pathTemplate: null,
    inputSchema: {
      ...READ_ONLY_PROPS,
      properties: {
        toolName: {
          type: 'string',
          description: 'Name of the mutating tool to invoke.'
        },
        method: {
          type: 'string',
          description: 'HTTP method (e.g. POST, PUT, DELETE).'
        },
        path: {
          type: 'string',
          description: 'Upstream path the token was issued for.'
        },
        token: {
          type: 'string',
          description: 'Approval token returned by approve_operation.'
        }
      },
      required: ['toolName', 'method', 'path', 'token']
    },
    // Handled directly by server.js so it can run the registered
    // mutating handler after verifying the token.
    handler: async () => formatError(new Error('invoke_approved_operation is handled by the server dispatcher'))
  }
};

export const TOOL_NAMES = Object.freeze(Object.keys(toolDefinitions));

export function getToolDefinition(name) {
  return toolDefinitions[name] || null;
}

// Map of tool name -> handler function. Convenience export so
// server.js does not need to reach through `toolDefinitions[name].handler`.
export const handlers = Object.freeze(
  Object.fromEntries(
    TOOL_NAMES.map((name) => [name, toolDefinitions[name].handler])
  )
);

// Internal helpers exposed for testing.
export const __internals = Object.freeze({ formatSuccess, formatError, redactErrorMessage });
