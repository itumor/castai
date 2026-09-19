mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
    }
  }

  mock_data "aws_eks_cluster" {
    defaults = {
      name     = "test-cluster"
      endpoint = "https://example.invalid"
      certificate_authority = [{
        data = "dGVzdA=="
      }]
      access_config = [{
        authentication_mode = "API"
      }]
      kubernetes_network_config = [{
        ip_family = "ipv4"
      }]
      vpc_config = [{
        vpc_id = "vpc-0123456789abcdef0"
      }]
    }
  }

  mock_data "aws_subnet" {
    defaults = {
      map_public_ip_on_launch = false
      vpc_id                  = "vpc-0123456789abcdef0"
    }
  }

  mock_data "aws_security_group" {
    defaults = {
      vpc_id = "vpc-0123456789abcdef0"
    }
  }
}

mock_provider "castai" {}
mock_provider "helm" {}

variables {
  cluster_name            = "test-cluster"
  aws_region              = "eu-central-1"
  node_subnet_ids         = ["subnet-0123456789abcdef0"]
  node_security_group_ids = ["sg-0123456789abcdef0"]
  max_cluster_cpu_cores   = 100
  castai_api_token        = "test-token"
}

run "valid_configuration" {
  command = plan
}

run "rejects_empty_subnet_list" {
  command = plan

  variables {
    node_subnet_ids = []
  }

  expect_failures = [var.node_subnet_ids]
}

run "rejects_empty_security_group_list" {
  command = plan

  variables {
    node_security_group_ids = []
  }

  expect_failures = [var.node_security_group_ids]
}

run "rejects_invalid_cpu_bounds" {
  command = plan

  variables {
    min_cluster_cpu_cores = 10
    max_cluster_cpu_cores = 5
  }

  expect_failures = [var.max_cluster_cpu_cores]
}

run "rejects_empty_token" {
  command = plan

  variables {
    castai_api_token = ""
  }

  expect_failures = [var.castai_api_token]
}

run "rejects_legacy_authentication" {
  command = plan

  override_data {
    target = data.aws_eks_cluster.target
    values = {
      name     = "test-cluster"
      endpoint = "https://example.invalid"
      certificate_authority = [{
        data = "dGVzdA=="
      }]
      access_config = [{
        authentication_mode = "CONFIG_MAP"
      }]
      kubernetes_network_config = [{
        ip_family = "ipv4"
      }]
      vpc_config = [{
        vpc_id = "vpc-0123456789abcdef0"
      }]
    }
  }

  expect_failures = [terraform_data.preflight]
}

run "rejects_wrong_vpc_subnet" {
  command = plan

  override_data {
    target = data.aws_subnet.nodes["subnet-0123456789abcdef0"]
    values = {
      map_public_ip_on_launch = false
      vpc_id                  = "vpc-0fedcba9876543210"
    }
  }

  expect_failures = [terraform_data.preflight]
}

run "rejects_public_subnet" {
  command = plan

  override_data {
    target = data.aws_subnet.nodes["subnet-0123456789abcdef0"]
    values = {
      map_public_ip_on_launch = true
      vpc_id                  = "vpc-0123456789abcdef0"
    }
  }

  expect_failures = [terraform_data.preflight]
}

run "rejects_wrong_vpc_security_group" {
  command = plan

  override_data {
    target = data.aws_security_group.nodes["sg-0123456789abcdef0"]
    values = {
      vpc_id = "vpc-0fedcba9876543210"
    }
  }

  expect_failures = [terraform_data.preflight]
}
