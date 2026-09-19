# Roadmap

## Backlog
- Connect support channels (Jira, email, Teams) · priority: high · area: support
  Need credentials/webhooks or API tokens in Granular Vault to auto-poll Jira queues, support inbox, and Teams. Until connected, user pastes tickets manually.
- Periodic health-check automation · priority: medium · area: ops
  Script that runs tf-check + k8s-diag on a schedule against managed clusters.
- Expand brain with real ticket history · priority: medium · area: knowledge
  As support cases are handled, file solved patterns in brain/notes/ to speed up future responses.

## In Progress
- (none)

## Testing
- (none)

## Done
- Super-engineer brain + workflow bootstrap · area: setup
  Created brain/ (BRAIN.md, support-runbook, product-map), scripts/ diagnostics, committed full Terraform stack with 9 passing tests.
