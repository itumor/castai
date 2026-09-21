"""Normalized Enterprise -> Organization -> Cluster model (read-only).

Wire-field mapping (see docs/enterprise-hierarchy.md):
  Organization.organization_id   <- GET /v1/organizations .organizations[].id
  Organization.organization_name <- .name
  Organization.parent_id         <- .parentId (nullable, beta)
  Organization.organization_type <- .type (free-form string; do NOT Enum()-crash)
  Cluster.cluster_id             <- GET /v1/kubernetes/external-clusters .items[].id
  Cluster.cluster_name           <- .items[].name  (NOT globally unique!)
  Cluster.provider               <- .items[].providerType (free text)
  Cluster.region                 <- .items[].region.name
  Cluster.status                 <- .items[].status (connecting/ready/warning/failed/deleting/...)

organization_id is stamped from the REQUEST scope onto every record.
Composite identity for clusters: (organization_id, cluster_id).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Enterprise:
    id: str
    name: str


@dataclass(frozen=True)
class Organization:
    organization_id: str
    organization_name: str
    parent_id: str | None
    organization_type: str


@dataclass(frozen=True)
class Cluster:
    organization_id: str
    organization_name: str
    cluster_id: str
    cluster_name: str
    provider: str
    region: str
    status: str
