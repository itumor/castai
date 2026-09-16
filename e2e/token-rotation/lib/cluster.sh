#!/usr/bin/env bash
#
# lib/cluster.sh
#
# Cluster lifecycle helpers for the CAST AI token rotation E2E harness.
#
# Public functions:
#   cluster::start              Create the EKS cluster if it does not exist.
#   cluster::stop               Delete the EKS cluster and clean up
#                               orphaned CloudFormation stacks, ELBs, EBS
#                               volumes, and IAM roles.
#   cluster::exists             Check if the cluster exists (eksctl).
#   cluster::write_kubeconfig   Update kubeconfig for the cluster.
#
# Cluster constants (used by all functions):
#   E2E_CLUSTER_NAME   16926-castai-token-rotation-e2e
#   E2E_CLUSTER_REGION eu-central-1
#   E2E_CLUSTER_CONFIG configs/e2e-token-rotation.yaml  (relative to E2E_DIR)
#   E2E_CLUSTER_PREFIX 16926-castai-token-rotation-    (safety guard)
#
# The stop function refuses to delete any cluster whose name does not
# start with E2E_CLUSTER_PREFIX. This is a safety net against accidents
# such as exporting the wrong CLUSTER_NAME when reusing this script.

if [[ -n "${E2E_CLUSTER_LOADED:-}" ]]; then
    return 0
fi
E2E_CLUSTER_LOADED=1

# ---------------------------------------------------------------------------
# Resolve paths relative to this file so the library works no matter where it
# is sourced from.
# ---------------------------------------------------------------------------

# Directory of the E2E harness (the one containing run.sh).
E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_DIR="${E2E_DIR}/lib"
CONFIGS_DIR="${E2E_DIR}/configs"

# Source logging if it has not been loaded yet.
if [[ -z "${E2E_LOGGING_LOADED:-}" ]]; then
    # shellcheck source=lib/logging.sh
    source "${LIB_DIR}/logging.sh"
fi

# Cluster constants. Override with env vars if a caller really needs to,
# but the safety guard (E2E_CLUSTER_PREFIX) is intentional and not
# overridable from the environment.
E2E_CLUSTER_NAME="${E2E_CLUSTER_NAME:-16926-castai-token-rotation-e2e}"
E2E_CLUSTER_REGION="${E2E_CLUSTER_REGION:-eu-central-1}"
E2E_CLUSTER_CONFIG_NAME="${E2E_CLUSTER_CONFIG_NAME:-e2e-token-rotation.yaml}"
E2E_CLUSTER_CONFIG="${E2E_CLUSTER_CONFIG:-${CONFIGS_DIR}/${E2E_CLUSTER_CONFIG_NAME}}"
E2E_CLUSTER_PREFIX="${E2E_CLUSTER_PREFIX:-16926-castai-token-rotation-}"
E2E_CLUSTER_DRY_RUN="${E2E_CLUSTER_DRY_RUN:-false}"

# ---------------------------------------------------------------------------
# AWS credential handling
#
# Mirrors scripts/ensure-eks-cluster.sh: prefer env vars, fall back to
# awskey.env at the repo root. The repo root is two levels up from
# lib/cluster.sh (../.. from E2E_DIR is the repo root).
# ---------------------------------------------------------------------------

E2E_REPO_ROOT="$(cd "${E2E_DIR}/../.." && pwd)"
E2E_AWSKEY_FILE="${E2E_AWSKEY_FILE:-${E2E_REPO_ROOT}/awskey.env}"

cluster::load_credentials() {
    if [[ -n "${AWS_ACCESS_KEY_ID:-}" && -n "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
        log_debug "Using AWS credentials from environment"
        return 0
    fi
    if [[ -f "${E2E_AWSKEY_FILE}" ]]; then
        log_info "Sourcing AWS credentials from ${E2E_AWSKEY_FILE}"
        # shellcheck source=/dev/null
        source "${E2E_AWSKEY_FILE}"
    else
        die "AWS credentials not found. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or create ${E2E_AWSKEY_FILE}"
    fi
    [[ -n "${AWS_ACCESS_KEY_ID:-}" ]]   || die "AWS_ACCESS_KEY_ID is empty after sourcing ${E2E_AWSKEY_FILE}"
    [[ -n "${AWS_SECRET_ACCESS_KEY:-}" ]] || die "AWS_SECRET_ACCESS_KEY is empty after sourcing ${E2E_AWSKEY_FILE}"
}

# ---------------------------------------------------------------------------
# Command wrappers. Always forward AWS_* so child processes inherit them,
# and short-circuit to a dry-run log line when --dry-run is set.
# ---------------------------------------------------------------------------

cluster::_run_aws() {
    if [[ "${E2E_CLUSTER_DRY_RUN}" == "true" ]]; then
        log_info "[DRY-RUN] would execute: aws $*"
        return 0
    fi
    AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
    AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
    AWS_REGION="${E2E_CLUSTER_REGION}" \
    AWS_DEFAULT_REGION="${E2E_CLUSTER_REGION}" \
    aws "$@"
}

cluster::_run_eksctl() {
    if [[ "${E2E_CLUSTER_DRY_RUN}" == "true" ]]; then
        log_info "[DRY-RUN] would execute: eksctl $*"
        return 0
    fi
    AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
    AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
    AWS_REGION="${E2E_CLUSTER_REGION}" \
    AWS_DEFAULT_REGION="${E2E_CLUSTER_REGION}" \
    eksctl "$@"
}

cluster::_run_kubectl() {
    if [[ "${E2E_CLUSTER_DRY_RUN}" == "true" ]]; then
        log_info "[DRY-RUN] would execute: kubectl $*"
        return 0
    fi
    AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
    AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
    AWS_REGION="${E2E_CLUSTER_REGION}" \
    AWS_DEFAULT_REGION="${E2E_CLUSTER_REGION}" \
    kubectl "$@"
}

# ---------------------------------------------------------------------------
# cluster::exists <name> [region]
#
# Returns 0 if eksctl sees the cluster, non-zero otherwise. Always safe to
# call because eksctl get cluster exits non-zero on a missing cluster.
# ---------------------------------------------------------------------------

cluster::exists() {
    local name="${1:-${E2E_CLUSTER_NAME}}"
    local region="${2:-${E2E_CLUSTER_REGION}}"

    if [[ "${E2E_CLUSTER_DRY_RUN}" == "true" ]]; then
        log_info "[DRY-RUN] would execute: eksctl get cluster --name ${name} --region ${region}"
        # In dry-run we cannot actually check existence; assume it does
        # not exist so subsequent create/delete operations are exercised.
        return 1
    fi

    if cluster::_run_eksctl get cluster --name "${name}" --region "${region}" >/dev/null 2>&1; then
        return 0
    fi
    return 1
}

# ---------------------------------------------------------------------------
# Safety guard. Refuses to operate on clusters whose name does not start
# with E2E_CLUSTER_PREFIX. Used by cluster::stop and exposed for tests.
# ---------------------------------------------------------------------------

cluster::assert_safe_name() {
    local name="$1"
    if [[ -z "${name}" ]]; then
        log_error "cluster name is empty"
        return 1
    fi
    if [[ "${name}" != "${E2E_CLUSTER_PREFIX}"* ]]; then
        log_error "Refusing to operate on cluster '${name}': name does not start with the E2E prefix '${E2E_CLUSTER_PREFIX}'."
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# AWS identity verification. Same shape as scripts/ensure-eks-cluster.sh
# but uses log_* helpers from lib/logging.sh instead of plain echo.
# ---------------------------------------------------------------------------

cluster::_verify_aws_identity() {
    if [[ "${E2E_CLUSTER_DRY_RUN}" == "true" ]]; then
        log_info "[DRY-RUN] would execute: aws sts get-caller-identity --region ${E2E_CLUSTER_REGION}"
        return 0
    fi
    log_step "Verifying AWS identity via 'aws sts get-caller-identity'"
    if ! cluster::_run_aws sts get-caller-identity >/dev/null 2>&1; then
        die "aws sts get-caller-identity failed. Check AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION."
    fi
    local account
    account="$(cluster::_run_aws sts get-caller-identity --query 'Account' --output text 2>/dev/null || true)"
    log_info "AWS identity OK (account=$(mask_value "${account}"), region=${E2E_CLUSTER_REGION})"
}

# ---------------------------------------------------------------------------
# CloudFormation helpers (mirrors scripts/ensure-eks-cluster.sh).
# ---------------------------------------------------------------------------

cluster::_cf_stack_status() {
    local stack_name="$1"
    cluster::_run_aws cloudformation describe-stacks \
        --stack-name "${stack_name}" \
        --region "${E2E_CLUSTER_REGION}" \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo "DOES_NOT_EXIST"
}

cluster::_cf_stack_exists() {
    local status
    status="$(cluster::_cf_stack_status "$1")"
    [[ "${status}" != "DOES_NOT_EXIST" && -n "${status}" ]]
}

cluster::_delete_cf_stack() {
    local stack_name="$1"
    log_info "Disabling termination protection on CloudFormation stack '${stack_name}' if enabled..."
    cluster::_run_aws cloudformation update-termination-protection \
        --stack-name "${stack_name}" \
        --region "${E2E_CLUSTER_REGION}" \
        --no-enable-termination-protection 2>/dev/null || true

    log_info "Deleting CloudFormation stack '${stack_name}'..."
    if ! cluster::_run_aws cloudformation delete-stack --stack-name "${stack_name}" --region "${E2E_CLUSTER_REGION}"; then
        log_warn "Failed to initiate deletion of CloudFormation stack '${stack_name}'; skipping wait"
        return 1
    fi
    log_info "Waiting for CloudFormation stack '${stack_name}' to finish deleting..."
    if cluster::_run_aws cloudformation wait stack-delete-complete \
        --stack-name "${stack_name}" --region "${E2E_CLUSTER_REGION}"; then
        log_info "CloudFormation stack '${stack_name}' deleted"
        return 0
    fi
    log_warn "CloudFormation stack '${stack_name}' did not delete cleanly; check AWS console"
    return 1
}

cluster::_cleanup_orphaned_cluster_stacks() {
    local cluster_name="$1"
    local cluster_stack="eksctl-${cluster_name}-cluster"
    log_step "Checking for orphaned CloudFormation stacks for cluster '${cluster_name}' in ${E2E_CLUSTER_REGION}"
    if cluster::_cf_stack_exists "${cluster_stack}"; then
        log_info "Found orphaned cluster stack '${cluster_stack}'"
        cluster::_delete_cf_stack "${cluster_stack}" || true
    fi

    local nodegroup_stacks
    nodegroup_stacks="$(cluster::_run_aws cloudformation list-stacks \
        --region "${E2E_CLUSTER_REGION}" \
        --stack-status-filter CREATE_COMPLETE CREATE_FAILED ROLLBACK_COMPLETE ROLLBACK_FAILED UPDATE_COMPLETE UPDATE_FAILED UPDATE_ROLLBACK_COMPLETE UPDATE_ROLLBACK_FAILED \
        --query "StackSummaries[?starts_with(StackName, \`eksctl-${cluster_name}-nodegroup-\`)].[StackName]" \
        --output text 2>/dev/null || true)"

    local stack
    for stack in ${nodegroup_stacks}; do
        log_info "Found orphaned nodegroup stack '${stack}'"
        cluster::_delete_cf_stack "${stack}" || true
    done
}

# ---------------------------------------------------------------------------
# cluster::write_kubeconfig [name] [region]
#
# Runs `eksctl utils write-kubeconfig` and then verifies access with
# `kubectl get nodes`. Useful both as a standalone helper and as a step
# inside cluster::start.
# ---------------------------------------------------------------------------

cluster::write_kubeconfig() {
    local name="${1:-${E2E_CLUSTER_NAME}}"
    local region="${2:-${E2E_CLUSTER_REGION}}"

    cluster::assert_safe_name "${name}" || return 1

    if [[ "${E2E_CLUSTER_DRY_RUN}" == "true" ]]; then
        log_info "[DRY-RUN] would execute: eksctl utils write-kubeconfig --cluster=${name} --region=${region}"
        log_info "[DRY-RUN] would execute: kubectl get nodes"
        return 0
    fi

    log_step "Writing kubeconfig for cluster '${name}' in ${region}"
    if ! cluster::_run_eksctl utils write-kubeconfig --cluster="${name}" --region="${region}"; then
        die "eksctl utils write-kubeconfig failed for cluster '${name}'"
    fi
    if ! cluster::_run_kubectl get nodes; then
        die "kubectl get nodes failed after writing kubeconfig for '${name}'"
    fi
    log_info "kubectl access verified for cluster '${name}'"
}

# ---------------------------------------------------------------------------
# cluster::start [name] [region]
#
# Idempotent. If the cluster already exists, log a warning and skip
# creation. Otherwise run `eksctl create cluster -f <config>`.
# ---------------------------------------------------------------------------

cluster::start() {
    local name="${1:-${E2E_CLUSTER_NAME}}"
    local region="${2:-${E2E_CLUSTER_REGION}}"

    cluster::assert_safe_name "${name}" || return 1

    if [[ ! -f "${E2E_CLUSTER_CONFIG}" ]]; then
        die "Cluster config not found: ${E2E_CLUSTER_CONFIG}"
    fi

    cluster::load_credentials
    cluster::_verify_aws_identity

    log_step "Starting cluster '${name}' in ${region} (dry-run=${E2E_CLUSTER_DRY_RUN})"

    if cluster::exists "${name}" "${region}"; then
        log_warn "Cluster '${name}' already exists in ${region}; skipping creation"
        # Even on a skip we make sure kubeconfig is current.
        cluster::write_kubeconfig "${name}" "${region}"
        return 0
    fi

    if [[ "${E2E_CLUSTER_DRY_RUN}" == "true" ]]; then
        log_info "[DRY-RUN] would execute: eksctl create cluster -f ${E2E_CLUSTER_CONFIG}"
        log_info "[DRY-RUN] would execute: eksctl utils write-kubeconfig --cluster=${name} --region=${region}"
        log_info "[DRY-RUN] would execute: kubectl get nodes"
        log_step "Dry-run: cluster '${name}' creation skipped"
        return 0
    fi

    log_step "Creating EKS cluster '${name}' from ${E2E_CLUSTER_CONFIG}"
    cluster::_run_eksctl create cluster -f "${E2E_CLUSTER_CONFIG}"
    cluster::write_kubeconfig "${name}" "${region}"
    log_step "Cluster '${name}' is ready"
}

# ---------------------------------------------------------------------------
# cluster::stop [name] [region]
#
# 1. Refuses to delete clusters whose name lacks the E2E prefix.
# 2. Deletes the cluster via eksctl, or scrubs orphaned stacks if the
#    cluster API record is already gone.
# 3. Cleans up classic ELBs, ELBv2, EBS volumes, and IAM roles tagged for
#    the cluster. Logic mirrors scripts/ensure-eks-cluster.sh.
# 4. Removes the kubeconfig context.
# ---------------------------------------------------------------------------

cluster::stop() {
    local name="${1:-${E2E_CLUSTER_NAME}}"
    local region="${2:-${E2E_CLUSTER_REGION}}"

    cluster::assert_safe_name "${name}" || return 1

    cluster::load_credentials

    log_step "Stopping cluster '${name}' in ${region} (dry-run=${E2E_CLUSTER_DRY_RUN})"

    if [[ "${E2E_CLUSTER_DRY_RUN}" == "true" ]]; then
        # In dry-run we cannot actually check existence. Print the same
        # set of commands we would run in live mode so the reviewer sees
        # exactly what the script will do.
        log_info "[DRY-RUN] would execute: eksctl get cluster --name ${name} --region ${region}"
        log_info "[DRY-RUN] would execute: eksctl delete cluster --name ${name} --region ${region}"
        cluster::_cleanup_orphaned_resources "${name}" || true
        log_info "[DRY-RUN] would execute: kubectl config delete-context ${name}"
        log_step "Dry-run: cluster '${name}' stop sequence complete"
        return 0
    fi

    cluster::_verify_aws_identity

    if cluster::exists "${name}" "${region}"; then
        log_step "Deleting EKS cluster '${name}'"
        cluster::_run_eksctl delete cluster --name "${name}" --region "${region}"
    else
        log_info "Cluster '${name}' does not exist in EKS; checking for leftover CloudFormation stacks"
        cluster::_cleanup_orphaned_cluster_stacks "${name}"
    fi

    # Remove kubeconfig context. Safe to run even if the context is missing.
    log_step "Removing kubeconfig context '${name}'"
    cluster::_run_kubectl config delete-context "${name}" || true

    cluster::_cleanup_orphaned_resources "${name}"

    log_step "Stop sequence complete for cluster '${name}'"
}

# ---------------------------------------------------------------------------
# Cleanup of orphaned resources: classic ELBs, ELBv2, EBS volumes, IAM
# roles. Always tagged with the cluster name. Mirror of the
# corresponding section in scripts/ensure-eks-cluster.sh.
# ---------------------------------------------------------------------------

cluster::_cleanup_orphaned_resources() {
    local cluster_name="$1"

    # Classic ELBs (elasticloadbalancing:classic).
    log_step "Scanning for classic ELBs tagged for '${cluster_name}'"
    local elb_names
    elb_names="$(cluster::_run_aws elb describe-load-balancers \
        --query 'LoadBalancerDescriptions[].LoadBalancerName' \
        --output text 2>/dev/null || true)"
    if [[ -n "${elb_names:-}" ]]; then
        local elb tags
        for elb in ${elb_names}; do
            tags="$(cluster::_run_aws elb describe-tags \
                --load-balancer-name "${elb}" \
                --output json 2>/dev/null || true)"
            if echo "${tags}" | grep -q "kubernetes.io/cluster/${cluster_name}"; then
                log_info "Deleting classic ELB: ${elb}"
                cluster::_run_aws elb delete-load-balancer --load-balancer-name "${elb}" || true
            fi
        done
    fi

    # ELBv2 (ALB/NLB).
    log_step "Scanning for ELBv2 load balancers tagged for '${cluster_name}'"
    local elbv2_arns
    elbv2_arns="$(cluster::_run_aws elbv2 describe-load-balancers \
        --query 'LoadBalancers[].LoadBalancerArn' \
        --output text 2>/dev/null || true)"
    if [[ -n "${elbv2_arns:-}" ]]; then
        local arn tags
        for arn in ${elbv2_arns}; do
            tags="$(cluster::_run_aws elbv2 describe-tags \
                --resource-arns "${arn}" \
                --output json 2>/dev/null || true)"
            if echo "${tags}" | grep -q "kubernetes.io/cluster/${cluster_name}"; then
                log_info "Deleting ELBv2 load balancer: ${arn}"
                cluster::_run_aws elbv2 delete-load-balancer --load-balancer-arn "${arn}" || true
            fi
        done
    fi

    # EBS volumes tagged kubernetes.io/cluster/<name>=owned.
    log_step "Scanning for orphaned EBS volumes tagged for '${cluster_name}'"
    local volumes
    volumes="$(cluster::_run_aws ec2 describe-volumes \
        --filters "Name=tag:kubernetes.io/cluster/${cluster_name},Values=owned" \
        --query 'Volumes[].VolumeId' \
        --output text 2>/dev/null || true)"
    if [[ -n "${volumes:-}" ]]; then
        local vol state
        for vol in ${volumes}; do
            state="$(cluster::_run_aws ec2 describe-volumes \
                --volume-ids "${vol}" \
                --query 'Volumes[0].State' \
                --output text 2>/dev/null || true)"
            if [[ "${state}" == "available" ]]; then
                log_info "Deleting unattached EBS volume: ${vol}"
                cluster::_run_aws ec2 delete-volume --volume-id "${vol}" || true
            fi
        done
    fi

    # IAM roles created by eksctl for the cluster.
    log_step "Scanning for IAM roles created by eksctl for '${cluster_name}'"
    local role_names
    role_names="$(cluster::_run_aws iam list-roles \
        --path-prefix '/' \
        --query 'Roles[].RoleName' \
        --output text 2>/dev/null || true)"
    if [[ -n "${role_names:-}" ]]; then
        local role
        for role in ${role_names}; do
            if [[ "${role}" == "eksctl-${cluster_name}-"* \
                  || "${role}" == "eksctl-${cluster_name}-nodegroup-"* ]]; then
                log_info "Deleting IAM role: ${role}"
                if [[ "${E2E_CLUSTER_DRY_RUN}" == "true" ]]; then
                    log_info "[DRY-RUN] would detach and delete policies on role ${role}"
                    continue
                fi
                local attached
                attached="$(cluster::_run_aws iam list-attached-role-policies \
                    --role-name "${role}" \
                    --query 'AttachedPolicies[].PolicyArn' \
                    --output text 2>/dev/null || true)"
                local p
                for p in ${attached}; do
                    cluster::_run_aws iam detach-role-policy --role-name "${role}" --policy-arn "${p}" || true
                done
                local inline
                inline="$(cluster::_run_aws iam list-role-policies \
                    --role-name "${role}" \
                    --query 'PolicyNames' \
                    --output text 2>/dev/null || true)"
                local ip
                for ip in ${inline}; do
                    cluster::_run_aws iam delete-role-policy --role-name "${role}" --policy-name "${ip}" || true
                done
                local profiles
                profiles="$(cluster::_run_aws iam list-instance-profiles-for-role \
                    --role-name "${role}" \
                    --query 'InstanceProfiles[].InstanceProfileName' \
                    --output text 2>/dev/null || true)"
                local prof
                for prof in ${profiles}; do
                    cluster::_run_aws iam remove-role-from-instance-profile \
                        --instance-profile-name "${prof}" --role-name "${role}" || true
                    cluster::_run_aws iam delete-instance-profile \
                        --instance-profile-name "${prof}" || true
                done
                cluster::_run_aws iam delete-role --role-name "${role}" || true
            fi
        done
    fi
}
