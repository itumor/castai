locals {
  name = "${var.cluster_name}-lab"

  azs = slice(data.aws_availability_zones.available.names, 0, 3)

  tags = merge(var.tags, { Name = var.cluster_name })
}
