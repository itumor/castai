# ------------------------------------------------------------------------------
# CAST AI Organization-Scope Onboarding for EKS
# ------------------------------------------------------------------------------
# This module is a CAST AI onboarding variant that operates at the CAST AI
# organization level (multi-account / multi-cluster). It provisions the
# organization-scoped CAST AI resources (groups, members, service accounts,
# keys, role bindings and SSO connections) that sit above any single cluster
# and are required to manage access to the organization from Terraform.
#
# All resources below are gated by `enable_*` toggles declared in
# variables.tf and source their attributes from the corresponding `*_config`
# variable via `lookup(..., default)`. Defaults are chosen so that
# `enable_<resource> = true` with an empty config produces a syntactically
# valid plan; consumers must override organization_id and other required
# values to apply against a real organization.
#
# All resource schemas were verified against the castai/castai provider
# v9.2.1 (terraform providers schema -json). None of the resources below
# accept a cluster_id; they are organization-scoped.
# ------------------------------------------------------------------------------

# ------------------------------------------------------------------------------
# Organization group
# ------------------------------------------------------------------------------
# Schema (castai/castai provider v9.2.1):
#   top-level:
#     - name            (REQ, string)
#     - organization_id (REQ, string)
#     - description     (OPT, string)
#     - id              (OPT/COMPUTED)
#   blocks:
#     members { list, member { list, { email REQ, id REQ, kind REQ } } }
#     timeouts { single, create/delete/update OPT }
# ------------------------------------------------------------------------------
resource "castai_organization_group" "this" {
  count = var.enable_organization_group ? 1 : 0

  name            = lookup(var.organization_group_config, "name", "default-organization-group")
  organization_id = lookup(var.organization_group_config, "organization_id", "00000000-0000-0000-0000-000000000000")
  description     = lookup(var.organization_group_config, "description", null)

  dynamic "members" {
    # Required nested block - default to a single empty list so the resource
    # remains valid when no members are supplied.
    for_each = [1]
    content {
      dynamic "member" {
        for_each = lookup(var.organization_group_config, "members", [])
        content {
          email = member.value.email
          id    = member.value.id
          kind  = member.value.kind
        }
      }
    }
  }
}

# ------------------------------------------------------------------------------
# Organization members
# ------------------------------------------------------------------------------
# Schema (castai/castai provider v9.2.1):
#   top-level:
#     - organization_id (REQ, string)
#     - members         (OPT, list of string; DEPRECATED - use
#                        castai_role_bindings for granular control)
#     - owners          (OPT, list of string; DEPRECATED)
#     - viewers         (OPT, list of string; DEPRECATED)
#     - id              (OPT/COMPUTED)
#   blocks:
#     timeouts { single, create/delete/update OPT }
#
# The deprecated `members` / `owners` / `viewers` attributes are surfaced for
# backwards compatibility; new consumers should prefer castai_role_bindings.
# ------------------------------------------------------------------------------
resource "castai_organization_members" "this" {
  count = var.enable_organization_members ? 1 : 0

  organization_id = lookup(var.organization_members_config, "organization_id", "00000000-0000-0000-0000-000000000000")
  members         = lookup(var.organization_members_config, "members", null)
  owners          = lookup(var.organization_members_config, "owners", null)
  viewers         = lookup(var.organization_members_config, "viewers", null)
}

# ------------------------------------------------------------------------------
# Service account
# ------------------------------------------------------------------------------
# Schema (castai/castai provider v9.2.1):
#   top-level:
#     - name            (REQ, string)
#     - organization_id (REQ, string)
#     - description     (OPT, string)
#     - email           (COMPUTED)
#     - author          (COMPUTED, list of object {email, id, kind})
#     - id              (OPT/COMPUTED)
#   blocks:
#     timeouts { single, create/delete/read/update OPT }
# ------------------------------------------------------------------------------
resource "castai_service_account" "this" {
  count = var.enable_service_account ? 1 : 0

  name            = lookup(var.service_account_config, "name", "default-service-account")
  organization_id = lookup(var.service_account_config, "organization_id", "00000000-0000-0000-0000-000000000000")
  description     = lookup(var.service_account_config, "description", null)
}

# ------------------------------------------------------------------------------
# Service account key
# ------------------------------------------------------------------------------
# Schema (castai/castai provider v9.2.1):
#   top-level:
#     - name              (REQ, string)
#     - organization_id   (REQ, string)
#     - service_account_id (REQ, string)
#     - active            (OPT, bool; default true)
#     - expires_at        (OPT, string RFC3339)
#     - last_used_at      (COMPUTED)
#     - prefix            (COMPUTED)
#     - token             (COMPUTED, sensitive)
#     - id                (OPT/COMPUTED)
#   blocks:
#     timeouts { single, create/delete/read/update OPT }
# ------------------------------------------------------------------------------
resource "castai_service_account_key" "this" {
  count = var.enable_service_account_key ? 1 : 0

  name               = lookup(var.service_account_key_config, "name", "default-service-account-key")
  organization_id    = lookup(var.service_account_key_config, "organization_id", "00000000-0000-0000-0000-000000000000")
  service_account_id = lookup(var.service_account_key_config, "service_account_id", "00000000-0000-0000-0000-000000000000")
  active             = lookup(var.service_account_key_config, "active", true)
  expires_at         = lookup(var.service_account_key_config, "expires_at", null)
}

# ------------------------------------------------------------------------------
# Role bindings
# ------------------------------------------------------------------------------
# Schema (castai/castai provider v9.2.1):
#   top-level:
#     - name            (REQ, string)
#     - organization_id (REQ, string)
#     - role_id         (REQ, string)
#     - description     (OPT/COMPUTED)
#     - id              (OPT/COMPUTED)
#   blocks:
#     scopes { list, { kind REQ, resource_id REQ } } - OPTIONAL
#     subjects { list (MIN 1), subject { list,
#                 kind REQ, group_id/service_account_id/user_id OPT/CMP } } - REQUIRED
#     timeouts { single, create/delete/update OPT }
# ------------------------------------------------------------------------------
resource "castai_role_bindings" "this" {
  count = var.enable_role_bindings ? 1 : 0

  name            = lookup(var.role_bindings_config, "name", "default-role-binding")
  organization_id = lookup(var.role_bindings_config, "organization_id", "00000000-0000-0000-0000-000000000000")
  role_id         = lookup(var.role_bindings_config, "role_id", "00000000-0000-0000-0000-000000000000")
  description     = lookup(var.role_bindings_config, "description", null)

  dynamic "scopes" {
    # Optional nested block - default to empty when not supplied.
    for_each = lookup(var.role_bindings_config, "scopes", [])
    content {
      kind        = scopes.value.kind
      resource_id = scopes.value.resource_id
    }
  }

  dynamic "subjects" {
    # Required nested block (min_items = 1) - default to a single empty
    # subjects list so the resource is valid when no subjects are supplied.
    for_each = [1]
    content {
      dynamic "subject" {
        for_each = lookup(var.role_bindings_config, "subjects", [])
        content {
          kind               = subject.value.kind
          group_id           = lookup(subject.value, "group_id", null)
          service_account_id = lookup(subject.value, "service_account_id", null)
          user_id            = lookup(subject.value, "user_id", null)
        }
      }
    }
  }
}

# ------------------------------------------------------------------------------
# SSO connection
# ------------------------------------------------------------------------------
# Schema (castai/castai provider v9.2.1):
#   top-level:
#     - name                     (REQ, string)
#     - email_domain             (REQ, string)
#     - additional_email_domains (OPT, list of string)
#     - synchronize_user_groups  (OPT, bool)
#     - sync_auth_token          (COMPUTED, sensitive)
#     - id                       (OPT/COMPUTED)
#   blocks (all OPTIONAL, max=1 each):
#     aad  { list(max=1), { ad_domain REQ, client_id REQ, client_secret REQ (sensitive) } }
#     oidc { list(max=1), { client_id REQ, client_secret REQ (sensitive),
#                           issuer_url REQ, type OPT } }
#     okta { list(max=1), { client_id REQ, client_secret REQ (sensitive),
#                           okta_domain REQ } }
#     timeouts { single, create/delete/update OPT }
# ------------------------------------------------------------------------------
resource "castai_sso_connection" "this" {
  count = var.enable_sso_connection ? 1 : 0

  name                     = lookup(var.sso_connection_config, "name", "default-sso-connection")
  email_domain             = lookup(var.sso_connection_config, "email_domain", "example.com")
  additional_email_domains = lookup(var.sso_connection_config, "additional_email_domains", null)
  synchronize_user_groups  = lookup(var.sso_connection_config, "synchronize_user_groups", null)

  dynamic "aad" {
    # Optional nested block - default to empty when not supplied.
    for_each = lookup(var.sso_connection_config, "aad", null) == null ? [] : [1]
    content {
      ad_domain     = lookup(lookup(var.sso_connection_config, "aad", {}), "ad_domain", "example.onmicrosoft.com")
      client_id     = lookup(lookup(var.sso_connection_config, "aad", {}), "client_id", "00000000-0000-0000-0000-000000000000")
      client_secret = lookup(lookup(var.sso_connection_config, "aad", {}), "client_secret", "")
    }
  }

  dynamic "oidc" {
    # Optional nested block - default to empty when not supplied.
    for_each = lookup(var.sso_connection_config, "oidc", null) == null ? [] : [1]
    content {
      client_id     = lookup(lookup(var.sso_connection_config, "oidc", {}), "client_id", "default-oidc-client")
      client_secret = lookup(lookup(var.sso_connection_config, "oidc", {}), "client_secret", "")
      issuer_url    = lookup(lookup(var.sso_connection_config, "oidc", {}), "issuer_url", "https://example.com/")
      type          = lookup(lookup(var.sso_connection_config, "oidc", {}), "type", null)
    }
  }

  dynamic "okta" {
    # Optional nested block - default to empty when not supplied.
    for_each = lookup(var.sso_connection_config, "okta", null) == null ? [] : [1]
    content {
      client_id     = lookup(lookup(var.sso_connection_config, "okta", {}), "client_id", "default-okta-client")
      client_secret = lookup(lookup(var.sso_connection_config, "okta", {}), "client_secret", "")
      okta_domain   = lookup(lookup(var.sso_connection_config, "okta", {}), "okta_domain", "example.okta.com")
    }
  }
}

# ------------------------------------------------------------------------------
# Enterprise group
# ------------------------------------------------------------------------------
# Schema (castai/castai provider v9.2.1):
#   top-level:
#     - enterprise_id    (REQ, string)
#     - organization_id  (REQ, string)
#     - name             (REQ, string)
#     - description      (OPT, string)
#     - id               (OPT/COMPUTED)
#   blocks:
#     members { list - OPTIONAL, member { list, { id REQ, kind REQ } } }
#     role_bindings { list - OPTIONAL, role_binding { list,
#                    { name REQ, role_id REQ, id COMPUTED,
#                      scopes { list (MIN 1), scope { list,
#                        { cluster OPT, organization OPT } } } } } }
#     timeouts { single, create/delete/update OPT }
#
# Note: the nested `role_bindings` block itself has min_items=1 only inside
# each `role_binding` entry, not on the outer `role_bindings` list. Both
# `members` and `role_bindings` are optional top-level list blocks; they
# default to empty when not supplied.
# ------------------------------------------------------------------------------
resource "castai_enterprise_group" "this" {
  count = var.enable_enterprise_group ? 1 : 0

  enterprise_id   = lookup(var.enterprise_group_config, "enterprise_id", "00000000-0000-0000-0000-000000000000")
  organization_id = lookup(var.enterprise_group_config, "organization_id", "00000000-0000-0000-0000-000000000000")
  name            = lookup(var.enterprise_group_config, "name", "default-enterprise-group")
  description     = lookup(var.enterprise_group_config, "description", null)

  dynamic "members" {
    # Optional outer block - render once (the outer `members` block is just
    # a wrapper around the `member` list, mirroring castai_organization_group).
    # When no members are supplied, the inner `member` iteration is empty.
    for_each = [1]
    content {
      dynamic "member" {
        for_each = lookup(var.enterprise_group_config, "members", [])
        content {
          id   = member.value.id
          kind = member.value.kind
        }
      }
    }
  }

  dynamic "role_bindings" {
    # Optional outer block - render once (the outer `role_bindings` block is
    # just a wrapper around the `role_binding` list). When no role bindings
    # are supplied, the inner `role_binding` iteration is empty.
    for_each = [1]
    content {
      dynamic "role_binding" {
        for_each = lookup(var.enterprise_group_config, "role_bindings", [])
        content {
          name    = role_binding.value.name
          role_id = role_binding.value.role_id

          dynamic "scopes" {
            # Required (min_items=1) inside each role_binding - default to
            # a single empty scopes list so the resource is valid.
            for_each = [1]
            content {
              dynamic "scope" {
                for_each = lookup(role_binding.value, "scopes", [])
                content {
                  cluster      = lookup(scope.value, "cluster", null)
                  organization = lookup(scope.value, "organization", null)
                }
              }
            }
          }
        }
      }
    }
  }
}

# ------------------------------------------------------------------------------
# Enterprise role binding
# ------------------------------------------------------------------------------
# Schema (castai/castai provider v9.2.1):
#   top-level:
#     - enterprise_id    (REQ, string)
#     - organization_id  (REQ, string)
#     - name             (REQ, string)
#     - role_id          (REQ, string)
#     - description      (OPT, string)
#     - id               (OPT/COMPUTED)
#   blocks:
#     scopes  { list (MIN 1, MAX 1) - REQUIRED,
#               cluster      { list, { id REQ } },
#               organization { list, { id REQ } } }
#     subjects { list (MIN 1, MAX 1) - REQUIRED,
#               group           { list, { id REQ } },
#               service_account { list, { id REQ } },
#               user            { list, { id REQ } } }
#     timeouts { single, create/delete/update OPT }
#
# The scopes/subjects outer blocks are required (min_items=1, max_items=1)
# and act as discriminators: each one contains exactly one inner list block
# (cluster or organization for scopes; group, service_account, or user for
# subjects). Inner lists default to empty so the resource validates with no
# explicit scope/subject supplied.
# ------------------------------------------------------------------------------
resource "castai_enterprise_role_binding" "this" {
  count = var.enable_enterprise_role_binding ? 1 : 0

  enterprise_id   = lookup(var.enterprise_role_binding_config, "enterprise_id", "00000000-0000-0000-0000-000000000000")
  organization_id = lookup(var.enterprise_role_binding_config, "organization_id", "00000000-0000-0000-0000-000000000000")
  name            = lookup(var.enterprise_role_binding_config, "name", "default-enterprise-role-binding")
  role_id         = lookup(var.enterprise_role_binding_config, "role_id", "00000000-0000-0000-0000-000000000000")
  description     = lookup(var.enterprise_role_binding_config, "description", null)

  dynamic "scopes" {
    # Required nested block (min_items=1, max_items=1) - default to a
    # single empty scopes entry so the resource is valid.
    for_each = [1]
    content {
      dynamic "cluster" {
        # Optional inner discriminator - default to empty.
        for_each = lookup(var.enterprise_role_binding_config, "cluster_scope_ids", [])
        content {
          id = cluster.value
        }
      }

      dynamic "organization" {
        # Optional inner discriminator - default to empty.
        for_each = lookup(var.enterprise_role_binding_config, "organization_scope_ids", [])
        content {
          id = organization.value
        }
      }
    }
  }

  dynamic "subjects" {
    # Required nested block (min_items=1, max_items=1) - default to a
    # single empty subjects entry so the resource is valid.
    for_each = [1]
    content {
      dynamic "group" {
        # Optional inner discriminator - default to empty.
        for_each = lookup(var.enterprise_role_binding_config, "group_subject_ids", [])
        content {
          id = group.value
        }
      }

      dynamic "service_account" {
        # Optional inner discriminator - default to empty.
        for_each = lookup(var.enterprise_role_binding_config, "service_account_subject_ids", [])
        content {
          id = service_account.value
        }
      }

      dynamic "user" {
        # Optional inner discriminator - default to empty.
        for_each = lookup(var.enterprise_role_binding_config, "user_subject_ids", [])
        content {
          id = user.value
        }
      }
    }
  }
}

# ------------------------------------------------------------------------------
# Enterprise service account
# ------------------------------------------------------------------------------
# Schema (castai/castai provider v9.2.1):
#   top-level:
#     - enterprise_id    (REQ, string)
#     - name             (REQ, string)
#     - description      (OPT, string)
#     - organization_id  (OPT/COMPUTED - defaults to enterprise_id when
#                         enterprise-scoped)
#     - email            (COMPUTED)
#     - id               (OPT/COMPUTED)
#   blocks:
#     timeouts { single, create/delete/update OPT }
# ------------------------------------------------------------------------------
resource "castai_enterprise_service_account" "this" {
  count = var.enable_enterprise_service_account ? 1 : 0

  enterprise_id = lookup(var.enterprise_service_account_config, "enterprise_id", "00000000-0000-0000-0000-000000000000")
  name          = lookup(var.enterprise_service_account_config, "name", "default-enterprise-service-account")
  description   = lookup(var.enterprise_service_account_config, "description", null)
  # organization_id is OPT/COMPUTED - omit when not provided so the API
  # defaults it to enterprise_id (enterprise scope).
  organization_id = lookup(var.enterprise_service_account_config, "organization_id", null)
}
