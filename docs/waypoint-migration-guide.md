# Waypoint Authentication Migration Guide

This guide walks you through migrating from sidecar-based authentication to waypoint-based authentication in Kagenti.

## Why Migrate?

**Resource savings:**
- Eliminate 3 sidecar containers per agent pod
- Reduce per-agent overhead from ~200m CPU / 384Mi memory to zero
- Consolidate L7 proxy functionality into 1 waypoint gateway per namespace

**Example:** 100 agents across 5 namespaces
- **Before:** 300 sidecar containers, 20 CPU cores, 38 GB memory
- **After:** 5 waypoint gateways, 0.5 CPU cores, 0.6 GB memory
- **Savings:** ~97% reduction in authentication infrastructure overhead

## Prerequisites

### 1. Verify Istio Ambient Mesh

Your cluster must have Istio installed with ambient mode enabled.

**Check Istio version:**

```bash
kubectl get deployment istiod -n istio-system \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
```

**Verify ambient mode is enabled:**

```bash
kubectl get deployment istiod -n istio-system \
  -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="PILOT_ENABLE_AMBIENT")].value}'
# Expected: true
```

**Check ztunnel is running:**

```bash
kubectl get daemonset -n istio-system -l app=ztunnel
# Should show a DaemonSet with pods on each node
```

**Verify waypoint GatewayClass:**

```bash
kubectl get gatewayclass istio-waypoint
# Should exist
```

### 2. Install/Upgrade Kagenti Components

Update to versions with waypoint support:

```bash
# Upgrade kagenti-webhook (with waypoint mode)
helm upgrade kagenti-webhook oci://ghcr.io/kagenti/kagenti-extensions/kagenti-webhook-chart \
  --version <version> \
  --namespace kagenti-webhook-system \
  --set webhook.defaultAuthMode=waypoint

# Upgrade kagenti-operator (with waypoint provisioning)
helm upgrade kagenti-operator oci://ghcr.io/kagenti/kagenti-operator-chart \
  --version <version> \
  --namespace kagenti-operator-system \
  --set operator.enableWaypointProvisioning=true
```

## Migration Strategies

Choose a strategy based on your risk tolerance and agent count.

### Strategy 1: Big Bang (Low Agent Count)

**Best for:** <20 agents, non-production environments

**Steps:**

1. Update webhook default mode to waypoint
2. Restart all agent deployments
3. Verify functionality

**Pros:** Fast, simple
**Cons:** All agents restart simultaneously

### Strategy 2: Gradual Rollout (Recommended)

**Best for:** Production environments, >20 agents

**Steps:**

1. Keep webhook default mode as sidecar
2. Migrate namespaces one at a time
3. Test each namespace before proceeding
4. After all namespaces migrated, flip webhook default

**Pros:** Low risk, easy rollback
**Cons:** Takes longer

### Strategy 3: Blue-Green by Namespace

**Best for:** Large deployments with strict SLAs

**Steps:**

1. Create new "green" namespaces with waypoint mode
2. Deploy agents to green namespaces
3. Switch traffic to green
4. Decommission "blue" namespaces

**Pros:** Zero downtime, easy rollback
**Cons:** Requires traffic switching mechanism

## Step-by-Step Migration (Gradual Rollout)

### Step 1: Prepare the Environment

Ensure the kagenti-operator is running with waypoint provisioning enabled:

```bash
kubectl get deployment kagenti-operator -n kagenti-operator-system -o yaml | \
  grep -A 1 'enable-waypoint-provisioning'
# Should show: - --enable-waypoint-provisioning=true
```

### Step 2: Choose a Pilot Namespace

Start with a non-critical namespace:

```bash
# Example: migrate team1 namespace
export NAMESPACE=team1
```

### Step 3: Apply Istio Labels

The operator will do this automatically, but you can do it manually for faster results:

```bash
kubectl label namespace $NAMESPACE \
  istio-discovery=enabled \
  istio.io/dataplane-mode=ambient \
  istio.io/use-waypoint=${NAMESPACE}-waypoint \
  --overwrite
```

### Step 4: Create Waypoint Gateway

The operator creates this automatically when it detects agents in the namespace.

To verify it exists:

```bash
kubectl get gateway ${NAMESPACE}-waypoint -n $NAMESPACE
```

If it doesn't exist, you can create it manually:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: ${NAMESPACE}-waypoint
  namespace: ${NAMESPACE}
  labels:
    istio.io/waypoint-for: all
spec:
  gatewayClassName: istio-waypoint
  listeners:
  - name: mesh
    port: 15008
    protocol: HBONE
EOF
```

Wait for the gateway to be ready:

```bash
kubectl wait --for=condition=Programmed gateway/${NAMESPACE}-waypoint -n $NAMESPACE --timeout=60s
```

### Step 5: Update Agent Deployments

For each agent deployment in the namespace:

```bash
# List all agent deployments
kubectl get deployments -n $NAMESPACE -l kagenti.io/type=agent

# Update each deployment to use waypoint mode
for DEPLOYMENT in $(kubectl get deployments -n $NAMESPACE -l kagenti.io/type=agent -o name); do
  kubectl patch $DEPLOYMENT -n $NAMESPACE --type=merge -p '
spec:
  template:
    metadata:
      labels:
        kagenti.io/auth-mode: waypoint
'
done
```

### Step 6: Rolling Restart

Restart deployments to pick up the new authentication mode:

```bash
kubectl rollout restart deployment -n $NAMESPACE -l kagenti.io/type=agent
```

### Step 7: Verify Sidecar Removal

Check that agents now have only 1 container (no sidecars):

```bash
kubectl get pods -n $NAMESPACE -l kagenti.io/type=agent \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[*].name}{"\n"}{end}'

# Expected output (example):
# weather-agent-7b5c9d8f4-x2k9m    weather-agent
# github-agent-6d4f8c9e3-p5h7n     github-agent

# Should NOT show: envoy-proxy, spiffe-helper, kagenti-client-registration
```

### Step 8: Verify Functionality

Test that agents can still communicate with external services:

```bash
# Get a sample agent pod
POD=$(kubectl get pod -n $NAMESPACE -l kagenti.io/type=agent -o jsonpath='{.items[0].metadata.name}')

# Test outbound connectivity (example with weather agent)
kubectl exec -it $POD -n $NAMESPACE -- curl -v https://api.weather.gov/
```

Look for successful responses (HTTP 200).

### Step 9: Check Waypoint Logs

Verify that traffic is flowing through the waypoint:

```bash
# Get waypoint pod
WAYPOINT_POD=$(kubectl get pod -n $NAMESPACE -l gateway.networking.k8s.io/gateway-name=${NAMESPACE}-waypoint -o jsonpath='{.items[0].metadata.name}')

# View logs
kubectl logs -n $NAMESPACE $WAYPOINT_POD --tail=50 -f
```

You should see logs showing:
- JWT validation
- OAuth2 token exchange
- Proxied requests to external services

### Step 10: Monitor Resource Usage

Compare resource usage before and after:

```bash
# Before migration (sidecar mode)
# 3 containers per agent: agent + envoy-proxy + spiffe-helper + client-registration
kubectl top pods -n $NAMESPACE --containers

# After migration (waypoint mode)
# 1 container per agent + 1 waypoint pod for the namespace
kubectl top pods -n $NAMESPACE --containers
```

### Step 11: Repeat for Other Namespaces

Once verified in the pilot namespace, repeat steps 3-10 for each namespace:

```bash
for NS in team2 team3 team4; do
  echo "=== Migrating namespace: $NS ==="
  kubectl label namespace $NS \
    istio-discovery=enabled \
    istio.io/dataplane-mode=ambient \
    istio.io/use-waypoint=${NS}-waypoint \
    --overwrite

  kubectl wait --for=condition=Programmed gateway/${NS}-waypoint -n $NS --timeout=60s || true

  kubectl patch deployment -n $NS -l kagenti.io/type=agent --type=merge -p '
spec:
  template:
    metadata:
      labels:
        kagenti.io/auth-mode: waypoint
'

  kubectl rollout restart deployment -n $NS -l kagenti.io/type=agent

  echo "Waiting for rollout to complete..."
  kubectl rollout status deployment -n $NS -l kagenti.io/type=agent --timeout=5m
done
```

### Step 12: Flip Webhook Default Mode

After all namespaces are migrated and verified, update the webhook to default to waypoint mode:

```bash
helm upgrade kagenti-webhook oci://ghcr.io/kagenti/kagenti-extensions/kagenti-webhook-chart \
  --version <version> \
  --namespace kagenti-webhook-system \
  --reuse-values \
  --set webhook.defaultAuthMode=waypoint
```

From this point forward, all new agents will default to waypoint mode unless explicitly labeled for sidecar mode.

### Step 13: Cleanup Legacy Labels

After the webhook default is flipped, you can remove the explicit waypoint labels (agents will inherit the default):

```bash
for NS in team1 team2 team3 team4; do
  kubectl patch deployment -n $NS -l kagenti.io/type=agent --type=json -p='[
    {"op": "remove", "path": "/spec/template/metadata/labels/kagenti.io~1auth-mode"}
  ]'
done
```

## Rollback Procedure

If you need to rollback a namespace to sidecar mode:

### Quick Rollback (Single Namespace)

```bash
export NAMESPACE=team1

# Add sidecar mode label
kubectl patch deployment -n $NAMESPACE -l kagenti.io/type=agent --type=merge -p '
spec:
  template:
    metadata:
      labels:
        kagenti.io/auth-mode: sidecar
'

# Restart to re-inject sidecars
kubectl rollout restart deployment -n $NAMESPACE -l kagenti.io/type=agent
```

### Full Rollback (All Namespaces)

```bash
# Revert webhook default
helm upgrade kagenti-webhook oci://ghcr.io/kagenti/kagenti-extensions/kagenti-webhook-chart \
  --version <version> \
  --namespace kagenti-webhook-system \
  --reuse-values \
  --set webhook.defaultAuthMode=sidecar

# Restart all agents
for NS in team1 team2 team3 team4; do
  kubectl rollout restart deployment -n $NS -l kagenti.io/type=agent
done
```

## Troubleshooting

### Agents Can't Reach External Services

**Symptoms:** Agents fail to call external APIs (GitHub, Slack, etc.)

**Diagnosis:**

```bash
# Check namespace labels
kubectl get namespace $NAMESPACE -o yaml | grep istio

# Expected:
#   istio-discovery: enabled
#   istio.io/dataplane-mode: ambient
#   istio.io/use-waypoint: {namespace}-waypoint

# Check waypoint status
kubectl get gateway ${NAMESPACE}-waypoint -n $NAMESPACE
# PROGRAMMED should be True

# Check ztunnel logs
kubectl logs -n istio-system -l app=ztunnel --tail=50 | grep $NAMESPACE
```

**Resolution:**

```bash
# Reapply Istio labels
kubectl label namespace $NAMESPACE \
  istio-discovery=enabled \
  istio.io/dataplane-mode=ambient \
  istio.io/use-waypoint=${NAMESPACE}-waypoint \
  --overwrite

# Restart agents
kubectl rollout restart deployment -n $NAMESPACE -l kagenti.io/type=agent
```

### Waypoint Gateway Not Created

**Symptoms:** `kubectl get gateway` shows no waypoint in the namespace

**Diagnosis:**

```bash
# Check operator logs
kubectl logs -n kagenti-operator-system deployment/kagenti-operator --tail=50 | grep waypoint
```

**Resolution:**

```bash
# Manually create the gateway
cat <<EOF | kubectl apply -f -
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: ${NAMESPACE}-waypoint
  namespace: ${NAMESPACE}
  labels:
    istio.io/waypoint-for: all
spec:
  gatewayClassName: istio-waypoint
  listeners:
  - name: mesh
    port: 15008
    protocol: HBONE
EOF
```

### Sidecars Still Being Injected

**Symptoms:** Pods still have 3+ containers after migration

**Diagnosis:**

```bash
# Check deployment labels
kubectl get deployment -n $NAMESPACE <deployment-name> \
  -o jsonpath='{.spec.template.metadata.labels.kagenti\.io/auth-mode}'

# Check webhook logs
kubectl logs -n kagenti-webhook-system deployment/kagenti-webhook --tail=50
```

**Resolution:**

```bash
# Remove any lingering sidecar labels
kubectl label deployment <deployment-name> -n $NAMESPACE \
  kagenti.io/inject- \
  kagenti.io/envoy-proxy-inject- \
  kagenti.io/spiffe-helper-inject- \
  --overwrite

# Set waypoint mode explicitly
kubectl label deployment <deployment-name> -n $NAMESPACE \
  kagenti.io/auth-mode=waypoint --overwrite

# Restart
kubectl rollout restart deployment <deployment-name> -n $NAMESPACE
```

### Authentication Failures

**Symptoms:** 401/403 errors when agents call external services

**Diagnosis:**

```bash
# Check waypoint logs for token exchange errors
kubectl logs -n $NAMESPACE -l gateway.networking.k8s.io/gateway-name=${NAMESPACE}-waypoint

# Check Keycloak client registration
kubectl get secret -n $NAMESPACE -l kagenti.io/keycloak-client=true
```

**Resolution:**

```bash
# Verify operator-managed client registration is enabled
kubectl get deployment kagenti-operator -n kagenti-operator-system -o yaml | \
  grep enable-operator-client-registration
# Should be: - --enable-operator-client-registration=true

# Trigger re-registration
kubectl annotate deployment -n $NAMESPACE <deployment-name> \
  kagenti.io/reconcile=true --overwrite
```

## Best Practices

### 1. Test in Non-Production First

Always migrate a non-production namespace first to validate the process.

### 2. Monitor Resource Metrics

Use Prometheus/Grafana to track:
- CPU usage per namespace
- Memory usage per namespace
- Pod count
- Request success rates

### 3. Document Your Rollout Plan

Create a spreadsheet tracking:
- Namespace name
- Agent count
- Migration date
- Verification status
- Rollback if needed

### 4. Coordinate with Teams

Notify agent owners before migration:
- Expected downtime (pods restart)
- Validation steps they should perform
- Rollback plan

### 5. Keep Sidecar Mode Available

Don't remove sidecar mode support immediately. Keep it available for:
- Edge cases where waypoint doesn't work
- Gradual deprecation period (6 months)
- Emergency fallback

## Post-Migration Validation

### Health Check Script

```bash
#!/bin/bash
# validate-waypoint.sh - Run after migration

NAMESPACE=$1

echo "=== Validating waypoint setup for $NAMESPACE ==="

# Check namespace labels
echo "Checking namespace labels..."
kubectl get namespace $NAMESPACE -o yaml | grep -E 'istio-discovery|dataplane-mode|use-waypoint' || {
  echo "❌ Namespace missing Istio labels"
  exit 1
}
echo "✅ Namespace labels OK"

# Check waypoint gateway
echo "Checking waypoint gateway..."
kubectl get gateway ${NAMESPACE}-waypoint -n $NAMESPACE &>/dev/null || {
  echo "❌ Waypoint gateway not found"
  exit 1
}
kubectl wait --for=condition=Programmed gateway/${NAMESPACE}-waypoint -n $NAMESPACE --timeout=10s || {
  echo "❌ Waypoint gateway not ready"
  exit 1
}
echo "✅ Waypoint gateway OK"

# Check agent pods have no sidecars
echo "Checking agent pods..."
SIDECAR_COUNT=$(kubectl get pods -n $NAMESPACE -l kagenti.io/type=agent \
  -o jsonpath='{range .items[*]}{.spec.containers[*].name}{"\n"}{end}' | \
  grep -c -E 'envoy-proxy|spiffe-helper|client-registration' || true)

if [ "$SIDECAR_COUNT" -gt 0 ]; then
  echo "❌ Found $SIDECAR_COUNT sidecar containers (should be 0)"
  exit 1
fi
echo "✅ No sidecars found"

# Test connectivity from an agent pod
echo "Testing agent connectivity..."
POD=$(kubectl get pod -n $NAMESPACE -l kagenti.io/type=agent -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
if [ -z "$POD" ]; then
  echo "⚠️  No agent pods found, skipping connectivity test"
else
  kubectl exec -n $NAMESPACE $POD -- curl -s -o /dev/null -w "%{http_code}" https://api.github.com/ | grep -q 200 || {
    echo "❌ Connectivity test failed"
    exit 1
  }
  echo "✅ Connectivity test passed"
fi

echo ""
echo "🎉 Waypoint validation complete for $NAMESPACE"
```

Usage:

```bash
chmod +x validate-waypoint.sh
./validate-waypoint.sh team1
```

## FAQ

### Q: Can I mix waypoint and sidecar modes in the same namespace?

**A:** Yes, you can set `kagenti.io/auth-mode` on individual deployments. However, this is not recommended long-term as it complicates operations.

### Q: What happens to existing connections during migration?

**A:** Existing connections are terminated when the pod restarts. Clients should retry with exponential backoff.

### Q: Do I need to update my agent code?

**A:** No. The authentication mode is transparent to the agent application. Agents continue making HTTP requests the same way.

### Q: Can I use NetworkPolicies with waypoint mode?

**A:** Yes. Istio ambient mesh integrates with Kubernetes NetworkPolicies. Apply policies to agent pods as usual.

### Q: How do I monitor waypoint performance?

**A:** Istio provides Prometheus metrics for waypoint gateways. Query metrics like:
- `istio_requests_total{gateway_name="team1-waypoint"}`
- `istio_request_duration_milliseconds{gateway_name="team1-waypoint"}`

### Q: What if my cluster doesn't have Istio ambient?

**A:** Continue using sidecar mode. Waypoint mode requires Istio 1.23+ with ambient enabled.

## Next Steps

After successful migration:

1. **Update runbooks** to reflect waypoint architecture
2. **Train operators** on waypoint troubleshooting
3. **Monitor costs** - you should see significant resource savings
4. **Plan sidecar deprecation** - set a timeline to remove sidecar support
5. **Document lessons learned** - update this guide with your experience

## Support

If you encounter issues during migration:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review the [Architecture Document](./architecture/waypoint-authentication.md)
3. Check operator and webhook logs
4. Open an issue at https://github.com/kagenti/kagenti/issues
