# ------------------------------------------------------------------------------
# Component Toggles (derived from input variables)
# ------------------------------------------------------------------------------
output "enabled_flags" {
  description = "Map of organization-scope resource group -> enable flag, reflecting the current module configuration."
  value = {
    organization_group         = var.enable_organization_group
    organization_members       = var.enable_organization_members
    service_account            = var.enable_service_account
    service_account_key        = var.enable_service_account_key
    role_bindings              = var.enable_role_bindings
    sso_connection             = var.enable_sso_connection
    enterprise_group           = var.enable_enterprise_group
    enterprise_role_binding    = var.enable_enterprise_role_binding
    enterprise_service_account = var.enable_enterprise_service_account
  }
}

output "configs" {
  description = "Map of organization-scope resource group -> raw config object, as supplied to the module."
  value = {
    organization_group         = var.organization_group_config
    organization_members       = var.organization_members_config
    service_account            = var.service_account_config
    service_account_key        = var.service_account_key_config
    role_bindings              = var.role_bindings_config
    sso_connection             = var.sso_connection_config
    enterprise_group           = var.enterprise_group_config
    enterprise_role_binding    = var.enterprise_role_binding_config
    enterprise_service_account = var.enterprise_service_account_config
  }
}

# ------------------------------------------------------------------------------
# Resource IDs
# ------------------------------------------------------------------------------
# Map of organization-scope resource group -> resource id. Each entry is
# `null` when the corresponding toggle is disabled (the resource is not
# created in that case) so consumers can safely reference the output without
# conditional expressions of their own.
# ------------------------------------------------------------------------------
output "resource_ids" {
  description = "Map of organization-scope resource group -> id of the created resource (null when the corresponding enable_* toggle is false)."
  value = {
    organization_group         = var.enable_organization_group ? castai_organization_group.this[0].id : null
    organization_members       = var.enable_organization_members ? castai_organization_members.this[0].id : null
    service_account            = var.enable_service_account ? castai_service_account.this[0].id : null
    service_account_key        = var.enable_service_account_key ? castai_service_account_key.this[0].id : null
    role_bindings              = var.enable_role_bindings ? castai_role_bindings.this[0].id : null
    sso_connection             = var.enable_sso_connection ? castai_sso_connection.this[0].id : null
    enterprise_group           = var.enable_enterprise_group ? castai_enterprise_group.this[0].id : null
    enterprise_role_binding    = var.enable_enterprise_role_binding ? castai_enterprise_role_binding.this[0].id : null
    enterprise_service_account = var.enable_enterprise_service_account ? castai_enterprise_service_account.this[0].id : null
  }
}
