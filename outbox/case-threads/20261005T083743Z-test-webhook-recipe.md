# Test webhook recipe — org "Siemens-test-on", cluster demo-cluster

Goal: prove CAST AI → external endpoint delivery end-to-end without touching customer orgs.

## Step 1 — free receiver URL

1. Open **https://webhook.site** → it shows *"Your unique URL"* — copy it (keep the tab open; it logs every incoming request live).
2. Corporate-policy note: webhook.site requests are visible to anyone holding the URL, and the payload contains only cluster name + message (no secrets) — fine for a test. If policy forbids third-party receivers, use a private alternative: Hookdeck Console, or `ngrok http 8080` + a local listener.

## Step 2 — fill the Create alert form

| Field | Value |
|---|---|
| Delivery method | Webhook |
| Callback URL | `https://webhook.site/<your-unique-id>` |
| Category | **All** (broadest — catches whatever we trigger) |
| Clusters | `demo-cluster` ✓ (already selected) + keep *Include non-cluster alerts* on |
| Severity | all five ✓ |
| Request template | paste the JSON below |
| Authorization keys | **must add header: `Content-Type: application/json`** — this exact header was missing on the auto-created config in Siemens Dev and is what made its deliveries fail with 400 |

Paste-ready template (all fields are string-typed → renders valid JSON, no 422 risk):

```json
{
  "notification_id": "{{ .NotificationID }}",
  "org": "{{ .OrganizationID }}",
  "severity": "{{ .Severity }}",
  "name": "{{ .Name }}",
  "message": "{{ .Message }}",
  "cluster": "{{ .Cluster.Name }}",
  "timestamp": "{{ toISO8601 .Timestamp }}"
}
```

## Step 3 — quick endpoint sanity check (optional, 10 seconds)

Proves the receiver + your template shape before involving CAST AI:

```bash
curl -X POST "https://webhook.site/<your-unique-id>" \
  -H "Content-Type: application/json" \
  -d '{"notification_id":"test","severity":"WARNING","name":"Manual test","message":"hello from curl","cluster":"demo-cluster","timestamp":"2026-10-05T09:00:00Z"}'
```

You should see it appear in the webhook.site tab instantly. Note: this validates everything **except** CAST AI actually calling.

## Step 4 — trigger a REAL CAST AI event on demo-cluster

Deploy an unschedulable pod (needs only `kubectl` on demo-cluster):

```bash
kubectl apply -f - <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: castai-webhook-test
spec:
  replicas: 1
  selector:
    matchLabels:
      app: castai-webhook-test
  template:
    metadata:
      labels:
        app: castai-webhook-test
    spec:
      containers:
      - name: pause
        image: registry.k8s.io/pause:3.9
        resources:
          requests:
            cpu: "500"   # no instance can fit this -> stays Pending forever
EOF
```

- Within ~1–5 min CAST AI emits **"Pending pod detected"** (WARNING) — this is exactly the event Sergej's org produced today at 03:46 UTC.
- Watch the webhook.site tab for the POST, and the console Notifications feed for the event.

## Step 5 — clean up

```bash
kubectl delete deployment castai-webhook-test
```

Then either delete the test alert or keep it pointed at webhook.site disabled.

## What to check if nothing arrives

1. Console → the alert config shows status **CanConnect** or **FailedToConnect** after the first delivery attempt — FailedToConnect carries the endpoint's error message (that's how we found the Siemens Dev header issue).
2. Console **Notifications** feed: did the event fire at all? If yes → delivery problem (URL/header/template). If no → category/cluster filter mismatch.
3. webhook.site: distinguish "no request arrived" from "request arrived but looks wrong".
