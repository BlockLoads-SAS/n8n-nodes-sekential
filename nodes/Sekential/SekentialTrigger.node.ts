import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
	NodeConnectionTypes,
	NodeOperationError,
	type IHookFunctions,
	type IWebhookFunctions,
	type IWebhookResponseData,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';
import { requestErrorDetails } from './request-errors';

const resources = [
	{ name: 'Customer', value: 'customers' },
	{ name: 'Journey', value: 'journeys' },
	{ name: 'Object Record', value: 'object-records' },
	{ name: 'Playbook', value: 'playbooks' },
	{ name: 'Step', value: 'steps' },
];

async function apiRequest(
	context: IHookFunctions,
	method: 'GET' | 'POST' | 'DELETE',
	path: string,
	body?: Record<string, string>,
): Promise<{ id?: string; event?: string; callbackUrl?: string }> {
	const credentials = await context.getCredentials('sekentialApi');
	const base = new URL(String(credentials.tenantUrl));
	if (base.protocol !== 'https:' && !(base.protocol === 'http:' && base.hostname === 'localhost')) {
		throw new NodeOperationError(context.getNode(), 'Tenant URL must use HTTPS');
	}
	return (await context.helpers.httpRequestWithAuthentication.call(context, 'sekentialApi', {
		method,
		url: `${base.origin}/api/n8n/subscriptions${path}`,
		body,
		json: true,
	})) as { id?: string; event?: string; callbackUrl?: string };
}

export class SekentialTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sekential Trigger',
		name: 'sekentialTrigger',
		icon: { light: 'file:sekential.svg', dark: 'file:sekential.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["resource"] + "." + $parameter["event"]}}',
		description: 'Starts a workflow when tenant work changes in Sekential',
		defaults: { name: 'Sekential Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'sekentialApi', required: true }],
		webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'event' }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: resources,
				default: 'customers',
			},
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Created', value: 'created' },
					{ name: 'Updated', value: 'updated' },
				],
				default: 'created',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (typeof data.subscriptionId !== 'string' || typeof data.secret !== 'string')
					return false;
				try {
					const current = await apiRequest(this, 'GET', `/${data.subscriptionId}`);
					return (
						current.id === data.subscriptionId &&
						current.event ===
							`${this.getNodeParameter('resource')}.${this.getNodeParameter('event')}` &&
						current.callbackUrl === this.getNodeWebhookUrl('default')
					);
				} catch (error) {
					this.logger.warn('Could not verify Sekential subscription', {
						status: requestErrorDetails(error).status,
					});
					return false;
				}
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const callbackUrl = this.getNodeWebhookUrl('default');
				if (!callbackUrl) return false;
				const secret = randomBytes(32).toString('hex');
				const event = `${this.getNodeParameter('resource')}.${this.getNodeParameter('event')}`;
				const result = await apiRequest(this, 'POST', '', { callbackUrl, event, secret });
				if (!result.id) return false;
				const data = this.getWorkflowStaticData('node');
				data.subscriptionId = result.id;
				data.secret = secret;
				data.recentEventIds = [];
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (typeof data.subscriptionId !== 'string') return true;
				try {
					await apiRequest(this, 'DELETE', `/${data.subscriptionId}`);
				} catch (error) {
					if (requestErrorDetails(error).status !== 404) return false;
				}
				delete data.subscriptionId;
				delete data.secret;
				delete data.recentEventIds;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const data = this.getWorkflowStaticData('node');
		const secret = data.secret;
		const headers = this.getHeaderData();
		const timestamp = headers['x-sekential-timestamp'];
		const signature = headers['x-sekential-signature'];
		const request = this.getRequestObject();
		if (!request.rawBody) await request.readRawBody();
		const rawBody = request.rawBody;
		const seconds = Number(timestamp);
		const expected =
			typeof secret === 'string' && typeof timestamp === 'string' && rawBody
				? createHmac('sha256', secret).update(timestamp).update('.').update(rawBody).digest('hex')
				: '';
		const supplied =
			typeof signature === 'string' && signature.startsWith('sha256=') ? signature.slice(7) : '';
		const valid =
			Number.isFinite(seconds) &&
			Math.abs(Date.now() / 1000 - seconds) <= 300 &&
			expected.length === 64 &&
			/^[a-f0-9]{64}$/i.test(supplied) &&
			timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'));
		if (!valid) {
			this.getResponseObject().status(401).send('Unauthorized').end();
			return { noWebhookResponse: true };
		}
		const body = this.getBodyData();
		const eventId = body.id;
		if (
			body.event !== `${this.getNodeParameter('resource')}.${this.getNodeParameter('event')}` ||
			typeof eventId !== 'string'
		) {
			this.getResponseObject().status(400).send('Invalid event').end();
			return { noWebhookResponse: true };
		}
		const recent = Array.isArray(data.recentEventIds) ? (data.recentEventIds as string[]) : [];
		if (recent.includes(eventId)) return { webhookResponse: 'OK' };
		data.recentEventIds = [...recent.slice(-99), eventId];
		return { workflowData: [this.helpers.returnJsonArray([body])] };
	}
}
