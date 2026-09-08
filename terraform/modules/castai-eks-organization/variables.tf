# ------------------------------------------------------------------------------
# CAST AI Authentication / Connectivity
# ------------------------------------------------------------------------------
variable "castai_api_token" {
  type        = string
  sensitive   = true
  description = "CAST AI API token used to authenticate against the CAST AI REST API at the organization scope."
  default     = ""
}

variable "castai_api_url" {
  type        = string
  description = "CAST AI REST API URL."
  default     = "https://api.cast.ai"
}

# ------------------------------------------------------------------------------
# Component Toggles
# ------------------------------------------------------------------------------
# Each toggle gates a CAST AI organization-scoped resource group. When `false`
# (the default), no resources are created for that group. When `true`, the
# accompanying `*_config` variable is consumed to provision the resources.
# ------------------------------------------------------------------------------
variable "enable_organization_group" {
  type        = bool
  description = "Enable CAST AI organization-group resources."
  default     = false
}

variable "enable_organization_members" {
  type        = bool
  description = "Enable CAST AI organization-members resources."
  default     = false
}

variable "enable_service_account" {
  type        = bool
  description = "Enable CAST AI service-account resources."
  default     = false
}

variable "enable_service_account_key" {
  type        = bool
  description = "Enable CAST AI service-account-key resources."
  default     = false
}

variable "enable_role_bindings" {
  type        = bool
  description = "Enable CAST AI role-binding resources."
  default     = false
}

variable "enable_sso_connection" {
  type        = bool
  description = "Enable CAST AI SSO connection resources."
  default     = false
}

variable "enable_enterprise_group" {
  type        = bool
  description = "Enable CAST AI enterprise-group resources."
  default     = false
}

variable "enable_enterprise_role_binding" {
  type        = bool
  description = "Enable CAST AI enterprise-role-binding resources."
  default     = false
}

variable "enable_enterprise_service_account" {
  type        = bool
  description = "Enable CAST AI enterprise-service-account resources."
  default     = false
}

# ------------------------------------------------------------------------------
# Configuration Objects
# ------------------------------------------------------------------------------
# Each `*_config` variable carries the input payload for its resource group.
# Shape is intentionally `any` so consumers can pass provider-specific
# structures; attributes are wired to the corresponding CAST AI resources.
# ------------------------------------------------------------------------------
variable "organization_group_config" {
  type        = any
  description = "Configuration object for the organization-group resource group. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}

variable "organization_members_config" {
  type        = any
  description = "Configuration object for the organization-members resource group. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}

variable "service_account_config" {
  type        = any
  description = "Configuration object for the service-account resource group. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}

variable "service_account_key_config" {
  type        = any
  description = "Configuration object for the service-account-key resource group. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}

variable "role_bindings_config" {
  type        = any
  description = "Configuration object for the role-bindings resource group. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}

variable "sso_connection_config" {
  type        = any
  description = "Configuration object for the SSO connection resource group. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}

variable "enterprise_group_config" {
  type        = any
  description = "Configuration object for the enterprise-group resource group. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}

variable "enterprise_role_binding_config" {
  type        = any
  description = "Configuration object for the enterprise-role-binding resource group. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}

variable "enterprise_service_account_config" {
  type        = any
  description = "Configuration object for the enterprise-service-account resource group. Empty by default; attributes are wired to the corresponding CAST AI resource in main.tf."
  default     = {}
}
