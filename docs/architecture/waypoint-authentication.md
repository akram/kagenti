# Waypoint-Based Authentication Architecture

**Status:** Implemented
**Date:** April 2026
**Related:** [Identity Guide](../identity-guide.md), [AuthBridge](https://github.com/kagenti/kagenti-extensions/tree/main/AuthBridge)

## Overview

This document describes the waypoint-based authentication architecture for Kagenti, which replaces per-pod sidecar injection with centralized Istio ambient mesh waypoint gateways. This approach significantly reduces resource overhead while maintaining zero-trust security guarantees.

## Motivation

### Problems with Sidecar-Based Authentication

The original sidecar-based approach injected three containers per agent pod:

- **envoy-proxy** (UID 1337) - L7 proxy for traffic interception
- **spiffe-helper** - SPIFFE SVID retrieval from SPIRE agent
- **kagenti-client-registration** (UID 1000) - Keycloak client registration

**Resource overhead:**
- 3 additional containers per agent pod
- ~200m CPU and 384Mi memory per agent (requests + limits)
- Increased pod startup time due to init containers
- ConfigMap/Secret volume mounts per pod

**Example:** 100 agents = 300 extra containers, 20 CPU cores, 38 GB memory

### Benefits of Waypoint-Based Authentication

With Istio ambient mesh waypoints:

- **1 waypoint pod per namespace** (instead of 3 sidecars per pod)
- Agent pods run with a single container (the agent itself)
- Centralized L7 policy enforcement
- Faster agent pod startup (no proxy-init, no sidecar injection)
- Simpler pod security context (no fsGroup coordination)

**Example:** 100 agents in 5 namespaces = 5 waypoint pods, ~2.5 CPU cores, ~2.5 GB memory

**Savings:** ~88% reduction in resource overhead

## Architecture

### Waypoint Mode (New Default)

```
┌─────────────────────────────────────────────────────────────┐
│ Agent Namespace: team1                                       │
│                                                               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │ Agent Pod  │  │ Agent Pod  │  │ Agent Pod  │             │
│  │ ┌────────┐ │  │ ┌────────┐ │  │ ┌────────┐ │             │
│  │ │ agent  │ │  │ │ agent  │ │  │ │ agent  │ │             │
│  │ └────────┘ │  │ └────────┘ │  │ └────────┘ │             │
│  └────────────┘  └────────────┘  └────────────┘             │
│         │                │                │                  │
│         └────────────────┼────────────────┘                  │
│                          │                                   │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Waypoint Gateway (team1-waypoint)                    │   │
│  │  - L4: ztunnel (mTLS, transparent traffic capture)   │   │
│  │  - L7: Envoy + ext-proc (JWT validation, token exch) │   │
│  │  - AuthN/AuthZ: Keycloak integration                 │   │
│  │  - Client registration: operator-managed             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
                  External Services
              (GitHub, Slack, Weather API)
```

### Sidecar Mode (Legacy, Opt-In)

```
┌──────────────────────────────────────────────────────────┐
│ Agent Pod (kagenti.io/auth-mode=sidecar)                 │
│                                                           │
│  proxy-init (init container)                             │
│    │                                                      │
│    ▼ iptables redirect                                   │
│                                                           │
│  ┌────────┐  ┌───────────┐  ┌─────────────┐             │
│  │ agent  │  │envoy-proxy│  │spiffe-helper│             │
│  │        │  │           │  │             │             │
│  └────────┘  └───────────┘  └─────────────┘             │
│                                                           │
│  ┌───────────────────────┐                               │
│  │client-registration    │                               │
│  └───────────────────────┘                               │
└──────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### Waypoint Mode

| Component | Responsibility | Location |
|-----------|---------------|----------|
| **ztunnel** | L4 transparent mTLS proxy | DaemonSet (per node) |
| **Waypoint Gateway** | L7 HTTP proxy, JWT validation, token exchange | Namespace (1 per NS) |
| **kagenti-operator** | Keycloak client registration | Cluster-scoped |
| **kagenti-webhook** | No sidecar injection, label validation only | Cluster-scoped |

### Sidecar Mode (Legacy)

| Component | Responsibility | Location |
|-----------|---------------|----------|
| **proxy-init** | iptables redirect setup | Init container (per pod) |
| **envoy-proxy** | L7 HTTP proxy, JWT validation, token exchange | Sidecar (per pod) |
| **spiffe-helper** | SPIRE SVID retrieval | Sidecar (per pod) |
| **client-registration** | Keycloak client registration | Sidecar (per pod) |
| **kagenti-webhook** | Inject all 4 containers | Cluster-scoped |

## Authentication Mode Selection

### Label-Based Mode Selection

The authentication mode is determined by the `kagenti.io/auth-mode` label on the pod template.

**Priority:**

1. **Explicit mode label** - `kagenti.io/auth-mode=waypoint` or `kagenti.io/auth-mode=sidecar`
2. **Legacy labels** - `kagenti.io/inject=enabled` or `kagenti.io/envoy-proxy-inject=true` → sidecar mode
3. **Default configured mode** - Set via `--default-auth-mode` flag (default: `waypoint`)

**Examples:**

```yaml
# Waypoint mode (explicit)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-agent
spec:
  template:
    metadata:
      labels:
        kagenti.io/type: agent
        kagenti.io/auth-mode: waypoint

---
# Sidecar mode (explicit)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: legacy-agent
spec:
  template:
    metadata:
      labels:
        kagenti.io/type: agent
        kagenti.io/auth-mode: sidecar

---
# Waypoint mode (default, no label needed)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: default-agent
spec:
  template:
    metadata:
      labels:
        kagenti.io/type: agent
        # No auth-mode label → defaults to waypoint
```

### Helm Configuration

The default authentication mode is configurable via Helm:

```yaml
# charts/kagenti-webhook/values.yaml
webhook:
  defaultAuthMode: waypoint  # or "sidecar"
```

This translates to the `--default-auth-mode` CLI flag on the webhook deployment.

## Istio Ambient Mesh Integration

### Namespace Configuration

When the operator detects agents in a namespace, it automatically applies Istio ambient labels:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: team1
  labels:
    istio-discovery: enabled
    istio.io/dataplane-mode: ambient
    istio.io/use-waypoint: team1-waypoint
```

### Waypoint Gateway

The operator creates a Gateway resource using the `istio-waypoint` GatewayClass:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: team1-waypoint
  namespace: team1
  labels:
    istio.io/waypoint-for: all
spec:
  gatewayClassName: istio-waypoint
  listeners:
  - name: mesh
    port: 15008
    protocol: HBONE
```

**Key fields:**

- `gatewayClassName: istio-waypoint` - Uses Istio's waypoint controller
- `protocol: HBONE` - HTTP-Based Overlay Network Encapsulation (Istio ambient protocol)
- `port: 15008` - Standard Istio waypoint port
- `istio.io/waypoint-for: all` - Applies to all pods in the namespace

### Traffic Flow

1. **Outbound from agent pod:**
   - Application makes HTTP request (e.g., to GitHub API)
   - ztunnel (on same node) intercepts traffic transparently
   - ztunnel establishes mTLS tunnel to waypoint
   - Waypoint performs JWT validation + OAuth2 token exchange
   - Waypoint forwards to external service

2. **Inbound to agent pod:**
   - External request arrives at waypoint
   - Waypoint validates JWT token
   - Waypoint establishes mTLS tunnel to ztunnel
   - ztunnel delivers to agent pod

## Keycloak Client Registration

### Waypoint Mode

Client registration is handled by the **kagenti-operator** (not sidecars):

1. Operator watches for agent/tool Deployments
2. Operator registers client in Keycloak using SPIFFE identity
3. Operator creates Secret with client credentials
4. Operator adds annotation to pod template: `kagenti.io/keycloak-client-credentials-secret={name}`
5. Webhook mounts Secret into waypoint gateway (not into agent pod)

**Agent pod has NO access to Keycloak credentials** - they live only in the waypoint.

### Sidecar Mode (Legacy)

Client registration is handled by the **client-registration sidecar** in each pod:

1. Sidecar reads JWT-SVID from spiffe-helper
2. Sidecar registers with Keycloak
3. Sidecar writes credentials to shared volume
4. envoy-proxy reads credentials from shared volume

## Prerequisites

### Required Components

| Component | Version | Purpose |
|-----------|---------|---------|
| **Istio with ambient mode** | 1.23+ | Waypoint gateway infrastructure |
| **ztunnel DaemonSet** | (bundled with Istio) | L4 transparent proxy |
| **Gateway API CRDs** | v1.2.1+ | Gateway resource definitions |
| **Keycloak** | 21.0+ | OAuth2/OIDC provider |
| **SPIRE** (optional) | 1.9+ | SPIFFE identity (if using SPIRE mode) |

### Installation Validation

The `scripts/ocp/setup-kagenti.sh` script validates prerequisites:

```bash
# Checks performed:
# 1. istiod deployment exists
# 2. PILOT_ENABLE_AMBIENT=true
# 3. ztunnel DaemonSet running
# 4. istio-waypoint GatewayClass available
# 5. Istio CNI configured
```

Failure displays Red Hat ServiceMesh 3 installation instructions.

## Migration from Sidecar to Waypoint

### Migration Strategy

1. **Deploy waypoint infrastructure** (operator creates gateways automatically)
2. **Test with pilot agents** using `kagenti.io/auth-mode=waypoint`
3. **Verify token exchange and authentication** work correctly
4. **Migrate remaining agents** in batches (remove auth-mode label, let default apply)
5. **Monitor resource usage** (should see significant reduction)
6. **Deprecate sidecar mode** (set `webhook.defaultAuthMode=waypoint` in Helm)

### Migration Script

A migration script is provided at `tools/migrate-to-waypoint.sh`:

```bash
# Migrate a namespace to waypoint mode
./tools/migrate-to-waypoint.sh team1

# What it does:
# 1. Adds Istio ambient labels to namespace
# 2. Creates waypoint gateway
# 3. Updates agent deployments to remove sidecar labels
# 4. Restarts deployments to remove sidecars
```

### Rollback Procedure

To rollback to sidecar mode:

```bash
# Add label to agent deployment
kubectl patch deployment my-agent -p '
spec:
  template:
    metadata:
      labels:
        kagenti.io/auth-mode: sidecar
'

# Restart deployment
kubectl rollout restart deployment my-agent
```

The webhook will detect the label and inject sidecars on the next rollout.

## Security Considerations

### Trust Boundaries

**Waypoint mode:**
- Agent pod → ztunnel: mTLS (SPIFFE identity)
- ztunnel → waypoint: mTLS (SPIFFE identity)
- Waypoint → external: OAuth2 Bearer token (from token exchange)

**Sidecar mode:**
- Agent → envoy-proxy: localhost (no TLS)
- envoy-proxy → external: OAuth2 Bearer token (from token exchange)

### Credential Isolation

**Waypoint mode:**
- ✅ Agent pod NEVER sees Keycloak credentials
- ✅ Credentials stored only in waypoint gateway
- ✅ Operator manages credential lifecycle

**Sidecar mode:**
- ⚠️ Client credentials written to shared volume
- ⚠️ Agent pod can read credentials (same pod, shared volume)
- ⚠️ Client-registration sidecar manages credentials

**Waypoint mode provides better credential isolation.**

### Network Policies

Waypoint mode works with Kubernetes NetworkPolicies:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: agent-egress
  namespace: team1
spec:
  podSelector:
    matchLabels:
      kagenti.io/type: agent
  policyTypes:
  - Egress
  egress:
  # Allow to waypoint (implicit via Istio)
  # All external traffic goes through waypoint
```

## Performance Characteristics

### Resource Usage

**Per-agent overhead:**

| Mode | CPU (requests) | Memory (requests) | Additional Containers |
|------|----------------|-------------------|----------------------|
| Sidecar | ~150m | ~192Mi | 3 (envoy, spiffe, client-reg) |
| Waypoint | 0 | 0 | 0 |

**Per-namespace overhead:**

| Mode | CPU (requests) | Memory (requests) | Additional Pods |
|------|----------------|-------------------|-----------------|
| Sidecar | 0 | 0 | 0 |
| Waypoint | ~100m | ~128Mi | 1 (waypoint gateway) |

**Breakeven point:** ~2 agents per namespace (waypoint is cheaper beyond 2 agents)

### Latency Impact

**Sidecar mode:**
- Agent → localhost envoy: <1ms
- envoy → external: network latency

**Waypoint mode:**
- Agent → ztunnel: <1ms (node-local)
- ztunnel → waypoint: <5ms (in-cluster)
- waypoint → external: network latency

**Additional latency in waypoint mode: ~5ms for in-cluster hop**

For most AI agent workloads (LLM inference, API calls), this is negligible compared to external API latency (100ms+).

## Troubleshooting

### Waypoint Not Created

**Symptoms:** Agents deployed but no waypoint gateway in namespace

**Diagnosis:**

```bash
# Check if operator is running
kubectl get pods -n kagenti-operator-system

# Check operator logs
kubectl logs -n kagenti-operator-system deployment/kagenti-operator -f

# Check if waypoint provisioning is enabled
kubectl get deployment kagenti-operator -n kagenti-operator-system -o yaml | grep enable-waypoint
```

**Resolution:**

```bash
# Enable waypoint provisioning
kubectl set env deployment/kagenti-operator -n kagenti-operator-system \
  ENABLE_WAYPOINT_PROVISIONING=true

# Trigger namespace reconciliation
kubectl annotate namespace team1 kagenti.io/reconcile=true --overwrite
```

### Traffic Not Routing Through Waypoint

**Symptoms:** Agent can't reach external services

**Diagnosis:**

```bash
# Check namespace labels
kubectl get namespace team1 -o yaml | grep istio

# Expected:
#   istio-discovery: enabled
#   istio.io/dataplane-mode: ambient
#   istio.io/use-waypoint: team1-waypoint

# Check waypoint status
kubectl get gateway team1-waypoint -n team1
# Should show PROGRAMMED=True

# Check ztunnel logs
kubectl logs -n istio-system -l app=ztunnel --tail=50
```

**Resolution:**

```bash
# Reapply namespace labels
kubectl label namespace team1 \
  istio-discovery=enabled \
  istio.io/dataplane-mode=ambient \
  istio.io/use-waypoint=team1-waypoint --overwrite

# Restart agents
kubectl rollout restart deployment -n team1 -l kagenti.io/type=agent
```

### Sidecar Injection Still Happening

**Symptoms:** Agents have 3+ containers despite waypoint mode

**Diagnosis:**

```bash
# Check agent labels
kubectl get deployment my-agent -n team1 -o yaml | grep auth-mode

# Check webhook default mode
kubectl get deployment kagenti-webhook -n kagenti-webhook-system -o yaml | grep default-auth-mode
```

**Resolution:**

```bash
# Remove sidecar mode labels
kubectl patch deployment my-agent -n team1 --type=json -p='[
  {"op": "remove", "path": "/spec/template/metadata/labels/kagenti.io~1auth-mode"}
]'

# Or explicitly set waypoint mode
kubectl label deployment my-agent -n team1 \
  kagenti.io/auth-mode=waypoint --overwrite

# Restart
kubectl rollout restart deployment my-agent -n team1
```

## References

- [Istio Ambient Mesh Documentation](https://istio.io/latest/docs/ambient/)
- [Gateway API Specification](https://gateway-api.sigs.k8s.io/)
- [SPIFFE/SPIRE Documentation](https://spiffe.io/docs/)
- [OAuth2 Token Exchange RFC 8693](https://datatracker.ietf.org/doc/html/rfc8693)
- [Kagenti Identity Guide](../identity-guide.md)
- [AuthBridge Repository](https://github.com/kagenti/kagenti-extensions/tree/main/AuthBridge)
