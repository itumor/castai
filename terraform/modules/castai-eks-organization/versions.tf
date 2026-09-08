terraform {
  required_version = ">= 1.3.2"

  required_providers {
    # CAST AI provider is required so that the module can manage
    # organization-scoped CAST AI resources (groups, members, service
    # accounts, keys, role bindings and SSO connections).
    castai = {
      source  = "castai/castai"
      version = "~> 9.2.1"
    }
  }
}
