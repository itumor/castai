"""Enterprise discovery service (contract — implemented by Builder B3).

Algorithm (docs/enterprise-hierarchy.md): GET /v1/organizations -> resolve root
(config CASTAI_ENTERPRISE_ID override -> unique ENTERPRISE-type heuristic ->
clear error) -> scope = root + children(parentId == root.id) -> per-org cluster
list with scoping header. DEFAULT orgs are excluded. Per-org failure isolated;
only the organizations call itself is fatal.

Implementation note (B3 decision): cluster fan-out is owned by
services/cluster_service.build_fleet_dataframe, so this module returns
organizations ONLY (DiscoveryResult.clusters stays empty); `errors` records
orgs-call-level issues only.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from utils.errors import CastAIError

from models import Enterprise, Organization

TYPE_ENTERPRISE = "ORGANIZATION_TYPE_ENTERPRISE"
TYPE_CHILD = "ORGANIZATION_TYPE_CHILD"
TYPE_DEFAULT = "ORGANIZATION_TYPE_DEFAULT"


@dataclass(frozen=True)
class FetchError:
    organization_id: str
    organization_name: str
    operation: str
    message: str  # sanitized — never contains headers/secrets
    kind: str = ""  # exception class name (GAP-B), e.g. "ServerError"; "" when
    # the failure had no exception (e.g. a non-dict wire payload)


@dataclass
class DiscoveryResult:
    enterprise: Enterprise
    organizations: list[Organization]  # root + children, in scope
    errors: list[FetchError] = field(default_factory=list)


def _parse_organization(raw: dict) -> Organization:
    """Map one UserOrganization wire object to the frozen model.

    `type` and `parentId` are tolerated as free-form / nullable per spec —
    never Enum()-crash on unknown values.
    """
    org_type = raw.get("type") or TYPE_DEFAULT  # spec default when absent
    return Organization(
        organization_id=str(raw.get("id") or ""),
        organization_name=str(raw.get("name") or ""),
        parent_id=raw.get("parentId") or None,
        organization_type=str(org_type),
    )


def _resolve_root(organizations: list[Organization], enterprise_id: str | None) -> Organization:
    """Resolve the Enterprise root per enterprise-hierarchy.md §4."""
    if enterprise_id:
        match = [o for o in organizations if o.organization_id == enterprise_id]
        if not match:
            raise CastAIError(
                f"Configured enterprise id {enterprise_id!r} is not visible to this API key; "
                "check CASTAI_ENTERPRISE_ID or the key scope."
            )
        root = match[0]
        if root.organization_type != TYPE_ENTERPRISE:
            raise CastAIError(
                f"Configured enterprise id {enterprise_id!r} ({root.organization_name!r}) is "
                f"type {root.organization_type!r}, expected {TYPE_ENTERPRISE!r}."
            )
        return root
    candidates = [o for o in organizations if o.organization_type == TYPE_ENTERPRISE]
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        raise CastAIError(
            "No Enterprise organization is visible to this key; set CASTAI_ENTERPRISE_ID "
            "or use a different key."
        )
    listing = ", ".join(f"{o.organization_name!r} ({o.organization_id})" for o in candidates)
    raise CastAIError(
        f"Multiple Enterprise organizations visible to this key: {listing}. "
        "Set CASTAI_ENTERPRISE_ID to select one."
    )


def discover_enterprise_hierarchy(client, enterprise_id: str | None = None) -> DiscoveryResult:
    """Discover the Enterprise tree (root + in-scope child orgs).

    Fatal-on-failure: any error from GET /v1/organizations propagates (nothing
    can be discovered without it). DEFAULT orgs are excluded; CHILD orgs must
    be parented to the resolved root. Cluster fan-out is NOT done here.
    """
    payload = client.get_organizations()
    raw_orgs = payload.get("organizations") or []
    organizations = [_parse_organization(o) for o in raw_orgs if isinstance(o, dict)]

    root = _resolve_root(organizations, enterprise_id)
    children = [
        o
        for o in organizations
        if o.organization_type == TYPE_CHILD and o.parent_id == root.organization_id
    ]
    # Root first, then children in API order; DEFAULT orgs excluded.
    scope = [root, *children]

    return DiscoveryResult(
        enterprise=Enterprise(id=root.organization_id, name=root.organization_name),
        organizations=scope,
        errors=[],
    )
