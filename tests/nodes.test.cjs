const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const test = require('node:test');
const { NodeApiError } = require('n8n-workflow');

const { Sekential } = require('../dist/nodes/Sekential/Sekential.node.js');
const { SekentialTrigger } = require('../dist/nodes/Sekential/SekentialTrigger.node.js');

function wrappedHttpError(node, status, headers = {}) {
	const responseError = Object.assign(new Error(`Request failed with status code ${status}`), {
		response: { status, headers },
	});
	return new NodeApiError(node, responseError);
}

test('creates a customer with the tenant credential and returns the REST document', async () => {
	const calls = [];
	const context = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name) =>
			({ resource: 'customers', operation: 'create', name: 'Example', fields: '{}' })[name],
		getCredentials: async () => ({ tenantUrl: 'https://acme.sekential.com', apiKey: 'redacted' }),
		getNode: () => ({ name: 'Sekential', type: 'sekential', typeVersion: 1 }),
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: async (...args) => {
				calls.push(args);
				return { doc: { id: 'customer-1', name: 'Example' } };
			},
		},
	};
	const result = await new Sekential().execute.call(context);
	assert.deepEqual(result[0][0].json, { id: 'customer-1', name: 'Example' });
	assert.equal(calls[0][0], 'sekentialApi');
	assert.equal(calls[0][1].url, 'https://acme.sekential.com/api/customers');
	assert.equal(calls[0][1].body.name, 'Example');
});

test('reads every page when Return All is enabled', async () => {
	const pages = [];
	const context = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name) =>
			({ resource: 'customers', operation: 'getMany', returnAll: true })[name],
		getCredentials: async () => ({ tenantUrl: 'https://acme.sekential.com' }),
		getNode: () => ({ name: 'Sekential', type: 'sekential', typeVersion: 1 }),
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: async (_name, options) => {
				pages.push(options.qs.page);
				return options.qs.page === 1
					? { docs: [{ id: 'one' }], hasNextPage: true }
					: { docs: [{ id: 'two' }], hasNextPage: false };
			},
		},
	};
	const result = await new Sekential().execute.call(context);
	assert.deepEqual(pages, [1, 2]);
	assert.deepEqual(
		result[0].map(({ json }) => json.id),
		['one', 'two'],
	);
});

for (const status of [401, 403, 429]) {
	test(`retries HTTP ${status} rate limits wrapped by n8n with Retry-After`, async () => {
		let calls = 0;
		const node = { name: 'Sekential', type: 'sekential', typeVersion: 1 };
		const context = {
			getInputData: () => [{ json: {} }],
			getNodeParameter: (name) => ({ resource: 'user', operation: 'get' })[name],
			getCredentials: async () => ({ tenantUrl: 'https://acme.sekential.com' }),
			getNode: () => node,
			continueOnFail: () => false,
			helpers: {
				httpRequestWithAuthentication: async () => {
					calls++;
					if (calls === 1) throw wrappedHttpError(node, status, { 'retry-after': '0.001' });
					return { user: { id: 'user-1' } };
				},
			},
		};
		const result = await new Sekential().execute.call(context);
		assert.equal(calls, 2);
		assert.equal(result[0][0].json.id, 'user-1');
	});
}

test('does not retry an authentication failure without Retry-After', async () => {
	let calls = 0;
	const node = { name: 'Sekential', type: 'sekential', typeVersion: 1 };
	const context = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name) => ({ resource: 'user', operation: 'get' })[name],
		getCredentials: async () => ({ tenantUrl: 'https://acme.sekential.com' }),
		getNode: () => node,
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: async () => {
				calls++;
				throw wrappedHttpError(node, 401);
			},
		},
	};
	await assert.rejects(() => new Sekential().execute.call(context), { httpCode: '401' });
	assert.equal(calls, 1);
});

test('removes local subscription state when n8n wraps an already deleted subscription response', async () => {
	const state = {
		subscriptionId: 'subscription-1',
		secret: 'private',
		recentEventIds: ['event-1'],
	};
	const node = { name: 'Sekential Trigger', type: 'sekentialTrigger', typeVersion: 1 };
	const context = {
		getWorkflowStaticData: () => state,
		getCredentials: async () => ({ tenantUrl: 'https://acme.sekential.com' }),
		getNode: () => node,
		helpers: {
			httpRequestWithAuthentication: async () => {
				throw wrappedHttpError(node, 404);
			},
		},
	};
	const deleted = await new SekentialTrigger().webhookMethods.default.delete.call(context);
	assert.equal(deleted, true);
	assert.deepEqual(state, {});
});

test('registers, verifies, and removes the selected trigger subscription', async () => {
	const trigger = new SekentialTrigger();
	const state = {};
	const calls = [];
	const callbackUrl = 'https://n8n.example.com/webhook/customer-created';
	const context = {
		getWorkflowStaticData: () => state,
		getNodeWebhookUrl: () => callbackUrl,
		getNodeParameter: (name) => ({ resource: 'customers', event: 'created' })[name],
		getCredentials: async () => ({ tenantUrl: 'https://acme.sekential.com' }),
		getNode: () => ({ name: 'Sekential Trigger', type: 'sekentialTrigger', typeVersion: 1 }),
		helpers: {
			httpRequestWithAuthentication: async (credentialName, options) => {
				calls.push({ credentialName, ...options });
				return { id: 'subscription-1', event: 'customers.created', callbackUrl };
			},
		},
	};
	const hooks = trigger.webhookMethods.default;
	assert.equal(await hooks.checkExists.call(context), false);
	assert.equal(await hooks.create.call(context), true);
	assert.equal(calls[0].credentialName, 'sekentialApi');
	assert.equal(calls[0].method, 'POST');
	assert.equal(calls[0].url, 'https://acme.sekential.com/api/n8n/subscriptions');
	assert.equal(calls[0].body.callbackUrl, callbackUrl);
	assert.equal(calls[0].body.event, 'customers.created');
	assert.match(calls[0].body.secret, /^[a-f0-9]{64}$/);
	assert.equal(state.secret, calls[0].body.secret);
	assert.equal(state.subscriptionId, 'subscription-1');
	assert.equal(await hooks.checkExists.call(context), true);
	assert.equal(calls[1].method, 'GET');
	assert.equal(calls[1].url, 'https://acme.sekential.com/api/n8n/subscriptions/subscription-1');
	assert.equal(await hooks.delete.call(context), true);
	assert.equal(calls[2].method, 'DELETE');
	assert.equal(calls[2].url, calls[1].url);
	assert.deepEqual(state, {});
});

test('trigger accepts signed events once and rejects forged deliveries', async () => {
	const trigger = new SekentialTrigger();
	const secret = 'a'.repeat(64);
	const body = { id: 'event-1', event: 'customers.created', documentId: 'customer-1' };
	const rawBody = Buffer.from(JSON.stringify(body, null, 2));
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = createHmac('sha256', secret)
		.update(timestamp)
		.update('.')
		.update(rawBody)
		.digest('hex');
	const state = { secret, recentEventIds: [] };
	let rawBodyReads = 0;
	const request = {
		async readRawBody() {
			rawBodyReads++;
			this.rawBody = rawBody;
		},
	};
	let responseStatus = 200;
	const context = {
		getWorkflowStaticData: () => state,
		getHeaderData: () => ({
			'x-sekential-timestamp': timestamp,
			'x-sekential-signature': `sha256=${signature}`,
		}),
		getRequestObject: () => request,
		getBodyData: () => body,
		getNodeParameter: (name) => ({ resource: 'customers', event: 'created' })[name],
		getResponseObject: () => ({
			status(code) {
				responseStatus = code;
				return this;
			},
			send() {
				return this;
			},
			end() {
				return this;
			},
		}),
		helpers: { returnJsonArray: (values) => values.map((json) => ({ json })) },
	};
	const first = await trigger.webhook.call(context);
	assert.equal(first.workflowData[0][0].json.id, 'event-1');
	assert.equal(rawBodyReads, 1);
	const second = await trigger.webhook.call(context);
	assert.equal(second.webhookResponse, 'OK');
	assert.equal(rawBodyReads, 1);
	context.getHeaderData = () => ({
		'x-sekential-timestamp': timestamp,
		'x-sekential-signature': 'sha256=' + '0'.repeat(64),
	});
	const forged = await trigger.webhook.call(context);
	assert.equal(forged.noWebhookResponse, true);
	assert.equal(responseStatus, 401);
	context.getHeaderData = () => ({
		'x-sekential-timestamp': timestamp,
		'x-sekential-signature': 'sha256=' + 'z'.repeat(64),
	});
	const malformed = await trigger.webhook.call(context);
	assert.equal(malformed.noWebhookResponse, true);
	assert.equal(responseStatus, 401);
	for (const offset of [-600, 600]) {
		const expiredTimestamp = String(Math.floor(Date.now() / 1000) + offset);
		const expiredSignature = createHmac('sha256', secret)
			.update(expiredTimestamp)
			.update('.')
			.update(rawBody)
			.digest('hex');
		context.getHeaderData = () => ({
			'x-sekential-timestamp': expiredTimestamp,
			'x-sekential-signature': `sha256=${expiredSignature}`,
		});
		const expired = await trigger.webhook.call(context);
		assert.equal(expired.noWebhookResponse, true);
		assert.equal(responseStatus, 401);
	}
});
