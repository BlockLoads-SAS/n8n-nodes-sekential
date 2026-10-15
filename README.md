# Sekential nodes for n8n

Native action and webhook trigger nodes for tenant-scoped Sekential workflows.

## Install and connect

Once published to npm, an Owner or Admin can install
`@blockloads/n8n-nodes-sekential` in **Settings → Community nodes** on a
self-hosted n8n instance with community nodes enabled. Other members of that
instance can then use the installed nodes. See
[n8n's installation guide](https://docs.n8n.io/integrations/community-nodes/installation-and-management/gui-installation.md).

The Sekential tenant must run the n8n integration backend, including
`/api/n8n/connection`, `/api/n8n/subscriptions`, and its background delivery
job. Triggers require a public HTTPS n8n webhook URL reachable from Sekential;
configure n8n's production webhook URL before publishing a workflow. A
successful credential test confirms that the tenant has the connection endpoint.

n8n Cloud requires n8n to verify the package before it can be installed through
the node picker. This package has not yet been verified. See the
[verification process](https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes.md).

## Credentials

In Sekential, create a personal REST API key in **Account → Integrations** for
the tenant and user whose permissions the workflow should use. Set the
**Tenant URL** in the n8n credential to that tenant's URL (for example,
`https://acme.sekential.com`) and paste the key. The credential test calls
`GET /api/n8n/connection` and checks that the key belongs to this tenant host.
API keys are bound to one tenant; Sekential checks
document permissions for every action and rechecks them before event delivery.
Revoking the key prevents new API calls and event deliveries. After rotating a
key, deactivate and reactivate the workflow to register its trigger with the
new key.

## Action matrix

| Resource       | Get | Get Many | Create | Update |
| -------------- | --- | -------- | ------ | ------ |
| Current User   | Yes | —        | —      | —      |
| Customers      | Yes | Yes      | Yes    | Yes    |
| Journeys       | Yes | Yes      | Yes    | Yes    |
| Playbooks      | Yes | Yes      | Yes    | Yes    |
| Steps          | Yes | Yes      | —      | Yes    |
| Object records | Yes | Yes      | Yes    | Yes    |

The node uses Sekential's Payload REST API at `/api/<collection>`. Get and
Update offer a searchable record selector and a manual ID mode. Get Many
supports a limit or all pages; each returned document becomes a separate n8n
item. Create has typed name and parent-reference inputs where required.
Additional fields for Create and Update are supplied as a JSON object; the
Sekential API validates lifecycle rules, permissions, and field types. Step
creation is managed by the flow editor and is not exposed as a node action.

Responses contain the REST document as JSON. A list response emits its
`docs` array, not the pagination envelope. API errors use n8n's usual
`NodeApiError`; **Continue On Fail** returns an error item. HTTP 429, and
Sekential's API-key 401/403 with `Retry-After`, are retried up to three times
(capped at 30 seconds).
Use an n8n retry policy for transient failures beyond that.

## Trigger matrix

The trigger supports **Created** and **Updated** for Customers, Journeys,
Playbooks, Steps, and Object records. Publishing the n8n workflow registers
its HTTPS callback in Sekential; unpublishing removes it. The callback is
authenticated with HMAC-SHA256 over `<unix-seconds>.<raw-body>`. n8n rejects
invalid signatures and timestamps more than five minutes old, and suppresses
the most recent 100 event IDs to handle retries. Delivery is at least once;
use the event `id` for downstream idempotency, especially if a workflow fails
before n8n persists its duplicate cache.

Each event contains `id`, `event`, `tenantId`, `resource`, `documentId`,
and a small `data` projection (ID, name or title, and state where applicable).
Sekential queues delivery after a committed change and checks the subscribing
user's current tenant membership and document read permission before sending.
An unavailable callback is retried by the background job; HTTP 410 removes the
subscription.

## Examples

- [Create a customer from a manual start](examples/create-customer.json)
- [Read a customer when it is created](examples/customer-created.json)

Import either JSON file through n8n's **Import from File** action, set the
Sekential credential, and adjust the values before publishing.

## Development

```bash
npm ci
npm run build
npm run lint
npm test
```

For interactive testing on a development n8n instance, use `npm run dev`.
Maintainers should follow [PUBLISHING.md](PUBLISHING.md) for release checks,
npm authentication, and n8n verification.

The package is built for the current n8n community-node API. See the
[Sekential API schema](https://app.sekential.com/api/openapi.json) for detailed
field and operation contracts.
