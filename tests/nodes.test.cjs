const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const test = require('node:test');

const { Sekential } = require('../dist/nodes/Sekential/Sekential.node.js');
const { SekentialTrigger } = require('../dist/nodes/Sekential/SekentialTrigger.node.js');

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

test('retries Sekential API-key rate limits with Retry-After', async () => {
	let calls = 0;
	const context = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name) => ({ resource: 'user', operation: 'get' })[name],
		getCredentials: async () => ({ tenantUrl: 'https://acme.sekential.com' }),
		getNode: () => ({ name: 'Sekential', type: 'sekential', typeVersion: 1 }),
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: async () => {
				calls++;
				if (calls === 1)
					throw { statusCode: 401, response: { headers: { 'retry-after': '0.001' } } };
				return { user: { id: 'user-1' } };
			},
		},
	};
	const result = await new Sekential().execute.call(context);
	assert.equal(calls, 2);
	assert.equal(result[0][0].json.id, 'user-1');
});

test('trigger accepts signed events once and rejects forged deliveries', async () => {
	const trigger = new SekentialTrigger();
	const secret = 'a'.repeat(64);
	const body = { id: 'event-1', event: 'customers.created', documentId: 'customer-1' };
	const rawBody = Buffer.from(JSON.stringify(body));
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = createHmac('sha256', secret)
		.update(timestamp)
		.update('.')
		.update(rawBody)
		.digest('hex');
	const state = { secret, recentEventIds: [] };
	let responseStatus = 200;
	const context = {
		getWorkflowStaticData: () => state,
		getHeaderData: () => ({
			'x-sekential-timestamp': timestamp,
			'x-sekential-signature': `sha256=${signature}`,
		}),
		getRequestObject: () => ({ rawBody }),
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
	const second = await trigger.webhook.call(context);
	assert.equal(second.webhookResponse, 'OK');
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
});
