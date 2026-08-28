import crypto from 'node:crypto';

export default class ApprovalGate {
  constructor(mode = 'block') {
    this.mode = mode; // 'block' | 'approve' | 'allow'
    this.approvals = new Map(); // key -> { toolName, method, path, expiresAt }
  }

  // Returns true if the operation is a read (GET/HEAD) or if mode is 'allow'.
  isReadOnly(method) {
    const m = (method || 'GET').toUpperCase();
    return m === 'GET' || m === 'HEAD';
  }

  // Check whether a mutating operation is permitted.
  // Returns { allowed: boolean, reason?: string, token?: string }.
  check(toolName, method, path) {
    if (this.isReadOnly(method)) {
      return { allowed: true };
    }
    if (this.mode === 'allow') {
      return { allowed: true };
    }
    if (this.mode === 'block') {
      return { allowed: false, reason: `Write operation '${toolName}' is blocked. Set APPROVAL_MODE=approve to enable explicit approval.` };
    }
    // mode === 'approve'
    return { allowed: false, reason: `Write operation '${toolName}' requires explicit approval. Use approve_operation with token.` };
  }

  // Grant approval for one mutating operation.
  // Returns { allowed: true, token: string }.
  approve(toolName, method, path, approver = 'human') {
    const token = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const key = `${toolName}|${method.toUpperCase()}|${path}`;
    this.approvals.set(key, { toolName, method: method.toUpperCase(), path, token, approver, expiresAt: Date.now() + 5 * 60 * 1000 });
    return { allowed: true, token };
  }

  // Verify a token for a specific operation.
  isApproved(toolName, method, path, token) {
    const key = `${toolName}|${method.toUpperCase()}|${path}`;
    const record = this.approvals.get(key);
    if (!record) return false;
    if (record.token !== token) return false;
    if (Date.now() > record.expiresAt) {
      this.approvals.delete(key);
      return false;
    }
    this.approvals.delete(key); // one-time use
    return true;
  }
}
