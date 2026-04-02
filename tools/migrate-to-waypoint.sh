#!/usr/bin/env bash
# migrate-to-waypoint.sh - Migrate a Kagenti namespace from sidecar to waypoint authentication
#
# Usage:
#   ./migrate-to-waypoint.sh <namespace>
#
# Example:
#   ./migrate-to-waypoint.sh team1
#
# This script:
# 1. Validates Istio ambient mesh prerequisites
# 2. Applies Istio ambient labels to the namespace
# 3. Creates a waypoint gateway
# 4. Updates agent deployments to use waypoint mode
# 5. Restarts deployments to remove sidecars

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
info() {
  echo -e "${BLUE}ℹ${NC} $*"
}

success() {
  echo -e "${GREEN}✓${NC} $*"
}

warn() {
  echo -e "${YELLOW}⚠${NC} $*"
}

error() {
  echo -e "${RED}✗${NC} $*"
}

fail() {
  error "$*"
  exit 1
}

# Check prerequisites
check_prerequisites() {
  info "Checking prerequisites..."

  # Check kubectl
  if ! command -v kubectl &> /dev/null; then
    fail "kubectl is not installed. Please install kubectl first."
  fi

  # Check cluster connection
  if ! kubectl cluster-info &> /dev/null; then
    fail "Cannot connect to Kubernetes cluster. Please check your kubeconfig."
  fi

  # Check Istio ambient mesh
  info "Checking Istio ambient mesh..."

  if ! kubectl get deployment istiod -n istio-system &> /dev/null; then
    fail "istiod not found. Istio must be installed."
  fi

  AMBIENT_ENABLED=$(kubectl get deployment istiod -n istio-system \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="PILOT_ENABLE_AMBIENT")].value}' 2>/dev/null || echo "")

  if [[ "$AMBIENT_ENABLED" != "true" ]]; then
    fail "Istio ambient mode not enabled (PILOT_ENABLE_AMBIENT != true)"
  fi

  if ! kubectl get daemonset -n istio-system -l app=ztunnel &> /dev/null; then
    fail "ztunnel DaemonSet not found. Ambient mesh requires ztunnel."
  fi

  if ! kubectl get gatewayclass istio-waypoint &> /dev/null; then
    fail "istio-waypoint GatewayClass not found."
  fi

  success "Prerequisites validated"
}

# Validate namespace exists
validate_namespace() {
  local namespace=$1

  if ! kubectl get namespace "$namespace" &> /dev/null; then
    fail "Namespace '$namespace' does not exist"
  fi

  # Check if namespace has any agent deployments
  local agent_count
  agent_count=$(kubectl get deployments -n "$namespace" -l kagenti.io/type=agent -o name 2>/dev/null | wc -l)

  if [ "$agent_count" -eq 0 ]; then
    warn "Namespace '$namespace' has no agent deployments (kagenti.io/type=agent)"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      exit 0
    fi
  else
    success "Found $agent_count agent deployment(s) in namespace '$namespace'"
  fi
}

# Apply Istio ambient labels to namespace
apply_istio_labels() {
  local namespace=$1

  info "Applying Istio ambient mesh labels to namespace '$namespace'..."

  kubectl label namespace "$namespace" \
    istio-discovery=enabled \
    istio.io/dataplane-mode=ambient \
    istio.io/use-waypoint="${namespace}-waypoint" \
    --overwrite

  success "Istio labels applied"
}

# Create waypoint gateway
create_waypoint_gateway() {
  local namespace=$1
  local gateway_name="${namespace}-waypoint"

  info "Creating waypoint gateway '$gateway_name' in namespace '$namespace'..."

  # Check if gateway already exists
  if kubectl get gateway "$gateway_name" -n "$namespace" &> /dev/null; then
    warn "Waypoint gateway '$gateway_name' already exists"
    return 0
  fi

  # Create gateway
  cat <<EOF | kubectl apply -f -
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: ${gateway_name}
  namespace: ${namespace}
  labels:
    istio.io/waypoint-for: all
spec:
  gatewayClassName: istio-waypoint
  listeners:
  - name: mesh
    port: 15008
    protocol: HBONE
EOF

  # Wait for gateway to be ready
  info "Waiting for waypoint gateway to be ready..."
  if kubectl wait --for=condition=Programmed gateway/"$gateway_name" -n "$namespace" --timeout=60s; then
    success "Waypoint gateway created and ready"
  else
    error "Waypoint gateway not ready within 60 seconds"
    warn "You may need to check the gateway status manually:"
    warn "  kubectl get gateway $gateway_name -n $namespace"
    warn "  kubectl describe gateway $gateway_name -n $namespace"
  fi
}

# Update agent deployments to waypoint mode
update_agent_deployments() {
  local namespace=$1

  info "Updating agent deployments to waypoint mode..."

  # Get all agent deployments
  local deployments
  deployments=$(kubectl get deployments -n "$namespace" -l kagenti.io/type=agent -o name 2>/dev/null || true)

  if [ -z "$deployments" ]; then
    warn "No agent deployments found in namespace '$namespace'"
    return 0
  fi

  # Update each deployment
  local count=0
  while IFS= read -r deployment; do
    info "  Updating $deployment..."

    # Remove legacy sidecar labels
    kubectl label "$deployment" -n "$namespace" \
      kagenti.io/inject- \
      kagenti.io/envoy-proxy-inject- \
      kagenti.io/spiffe-helper-inject- \
      --overwrite 2>/dev/null || true

    # Set waypoint mode
    kubectl patch "$deployment" -n "$namespace" --type=merge -p '
spec:
  template:
    metadata:
      labels:
        kagenti.io/auth-mode: waypoint
' || {
      error "Failed to update $deployment"
      continue
    }

    count=$((count + 1))
  done <<< "$deployments"

  success "Updated $count deployment(s)"
}

# Restart agent deployments
restart_agent_deployments() {
  local namespace=$1

  info "Restarting agent deployments to remove sidecars..."

  kubectl rollout restart deployment -n "$namespace" -l kagenti.io/type=agent || {
    warn "Failed to restart some deployments"
    return 1
  }

  info "Waiting for rollouts to complete..."
  if kubectl rollout status deployment -n "$namespace" -l kagenti.io/type=agent --timeout=5m; then
    success "All deployments restarted successfully"
  else
    warn "Some deployments did not complete rollout within 5 minutes"
    warn "Check deployment status manually:"
    warn "  kubectl get deployments -n $namespace -l kagenti.io/type=agent"
  fi
}

# Verify sidecar removal
verify_sidecar_removal() {
  local namespace=$1

  info "Verifying sidecar removal..."

  # Get all agent pods
  local pods
  pods=$(kubectl get pods -n "$namespace" -l kagenti.io/type=agent -o name 2>/dev/null || true)

  if [ -z "$pods" ]; then
    warn "No agent pods found in namespace '$namespace'"
    return 0
  fi

  local sidecar_found=false
  while IFS= read -r pod; do
    local containers
    containers=$(kubectl get "$pod" -n "$namespace" -o jsonpath='{.spec.containers[*].name}')

    # Check for sidecar containers
    if echo "$containers" | grep -qE 'envoy-proxy|spiffe-helper|kagenti-client-registration|authbridge'; then
      error "  $pod still has sidecars: $containers"
      sidecar_found=true
    fi
  done <<< "$pods"

  if [ "$sidecar_found" = true ]; then
    error "Some pods still have sidecars"
    warn "You may need to manually delete the pods to force a restart"
    return 1
  fi

  success "No sidecars found in agent pods"
}

# Display summary
display_summary() {
  local namespace=$1

  echo ""
  echo "=========================================="
  echo "Migration Summary"
  echo "=========================================="
  echo ""
  echo "Namespace: $namespace"
  echo ""

  # Show namespace labels
  echo "Namespace labels:"
  kubectl get namespace "$namespace" -o jsonpath='{.metadata.labels}' | \
    jq -r 'to_entries[] | select(.key | startswith("istio")) | "  \(.key): \(.value)"'
  echo ""

  # Show waypoint gateway
  echo "Waypoint gateway:"
  kubectl get gateway "${namespace}-waypoint" -n "$namespace" 2>/dev/null || echo "  Not found"
  echo ""

  # Show agent deployments
  echo "Agent deployments:"
  kubectl get deployments -n "$namespace" -l kagenti.io/type=agent -o custom-columns=\
NAME:.metadata.name,\
REPLICAS:.spec.replicas,\
READY:.status.readyReplicas,\
AUTH-MODE:.spec.template.metadata.labels.kagenti\\.io/auth-mode 2>/dev/null || echo "  None"
  echo ""

  # Show agent pods
  echo "Agent pods (container count):"
  kubectl get pods -n "$namespace" -l kagenti.io/type=agent \
    -o custom-columns=NAME:.metadata.name,CONTAINERS:.spec.containers[*].name 2>/dev/null | \
    awk 'NR==1 || NF' || echo "  None"
  echo ""

  success "Migration complete!"
  echo ""
  echo "Next steps:"
  echo "  1. Test agent functionality in namespace '$namespace'"
  echo "  2. Verify traffic is flowing through waypoint:"
  echo "       kubectl logs -n $namespace -l gateway.networking.k8s.io/gateway-name=${namespace}-waypoint --tail=50"
  echo "  3. Monitor resource usage:"
  echo "       kubectl top pods -n $namespace"
  echo ""
}

# Main function
main() {
  if [ $# -ne 1 ]; then
    echo "Usage: $0 <namespace>"
    echo ""
    echo "Example:"
    echo "  $0 team1"
    echo ""
    echo "This script migrates a Kagenti namespace from sidecar to waypoint authentication."
    exit 1
  fi

  local namespace=$1

  echo ""
  echo "=========================================="
  echo "Kagenti Waypoint Migration"
  echo "=========================================="
  echo ""
  echo "Namespace: $namespace"
  echo ""

  # Confirmation prompt
  warn "This will:"
  echo "  1. Apply Istio ambient labels to namespace"
  echo "  2. Create a waypoint gateway"
  echo "  3. Update all agent deployments"
  echo "  4. Restart deployments (pods will be recreated)"
  echo ""
  read -p "Continue? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    info "Migration cancelled"
    exit 0
  fi
  echo ""

  # Run migration steps
  check_prerequisites
  validate_namespace "$namespace"
  apply_istio_labels "$namespace"
  create_waypoint_gateway "$namespace"
  update_agent_deployments "$namespace"
  restart_agent_deployments "$namespace"
  verify_sidecar_removal "$namespace"
  display_summary "$namespace"
}

# Run main function
main "$@"
