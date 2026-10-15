import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	sleep,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeExecutionData,
	type INodeListSearchResult,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';
import { requestErrorDetails } from './request-errors';

type Resource = 'customers' | 'journeys' | 'playbooks' | 'steps' | 'object-records';
const resources: Array<{ name: string; value: Resource }> = [
	{ name: 'Customer', value: 'customers' },
	{ name: 'Journey', value: 'journeys' },
	{ name: 'Object Record', value: 'object-records' },
	{ name: 'Playbook', value: 'playbooks' },
	{ name: 'Step', value: 'steps' },
];
const allResources = resources.map(({ value }) => value);
const creatable: Resource[] = ['customers', 'journeys', 'playbooks', 'object-records'];

function baseUrl(context: IExecuteFunctions | ILoadOptionsFunctions, value: unknown): string {
	if (typeof value !== 'string')
		throw new NodeOperationError(context.getNode(), 'Tenant URL is required');
	const url = new URL(value);
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
		throw new NodeOperationError(context.getNode(), 'Tenant URL must use HTTPS');
	}
	return url.origin;
}

async function request(
	context: IExecuteFunctions | ILoadOptionsFunctions,
	method: 'GET' | 'POST' | 'PATCH',
	path: string,
	qs?: Record<string, string | number>,
	body?: JsonObject,
): Promise<JsonObject> {
	const credentials = await context.getCredentials('sekentialApi');
	const url = `${baseUrl(context, credentials.tenantUrl)}/api/${path}`;
	for (let attempt = 0; ; attempt++) {
		try {
			return (await context.helpers.httpRequestWithAuthentication.call(context, 'sekentialApi', {
				method,
				url,
				qs,
				body,
				json: true,
			})) as JsonObject;
		} catch (error) {
			const { status, retryAfter } = requestErrorDetails(error);
			const rateLimited =
				status === 429 ||
				((status === 401 || status === 403) && Number.isFinite(retryAfter) && retryAfter > 0);
			if (!rateLimited || attempt >= 3)
				throw new NodeApiError(context.getNode(), error as JsonObject);
			const delay =
				Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
			await sleep(Math.min(delay, 30000));
		}
	}
}

function recordId(context: IExecuteFunctions, value: unknown): string {
	const id = typeof value === 'object' && value !== null && 'value' in value ? value.value : value;
	if (typeof id !== 'string' || !id.trim())
		throw new NodeOperationError(context.getNode(), 'Record ID is required');
	return id.trim();
}

function unwrapDocument(response: JsonObject, key = 'doc'): JsonObject {
	const value = response[key];
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as JsonObject)
		: response;
}

async function listRecords(
	context: IExecuteFunctions | ILoadOptionsFunctions,
	resource: Resource,
	limit: number,
	returnAll: boolean,
	search = '',
): Promise<JsonObject[]> {
	const rows: JsonObject[] = [];
	let page = 1;
	while (true) {
		const qs: Record<string, string | number> = {
			page,
			limit: Math.min(100, returnAll ? 100 : Math.max(1, limit - rows.length)),
			depth: 0,
		};
		if (search) qs[`where[${resource === 'steps' ? 'title' : 'name'}][like]`] = search;
		const response = await request(context, 'GET', resource, qs);
		if (!Array.isArray(response.docs))
			throw new NodeOperationError(
				context.getNode(),
				'Sekential returned an invalid list response',
			);
		if (response.hasNextPage && response.docs.length === 0)
			throw new NodeOperationError(
				context.getNode(),
				'Sekential returned an empty page with more results',
			);
		rows.push(...(response.docs as JsonObject[]));
		if (!response.hasNextPage || (!returnAll && rows.length >= limit)) break;
		page++;
	}
	return returnAll ? rows : rows.slice(0, limit);
}

export class Sekential implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sekential',
		name: 'sekential',
		icon: { light: 'file:sekential.svg', dark: 'file:sekential.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Read and update tenant work in Sekential',
		defaults: { name: 'Sekential' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'sekentialApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Current User', value: 'user' },
					{ name: 'Customer', value: 'customers' },
					{ name: 'Journey', value: 'journeys' },
					{ name: 'Object Record', value: 'object-records' },
					{ name: 'Playbook', value: 'playbooks' },
					{ name: 'Step', value: 'steps' },
				],
				default: 'customers',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['user'] } },
				options: [{ name: 'Get', value: 'get', action: 'Get the current user' }],
				default: 'get',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: creatable } },
				options: [
					{ name: 'Create', value: 'create', action: 'Create a record' },
					{ name: 'Get', value: 'get', action: 'Get a record' },
					{ name: 'Get Many', value: 'getMany', action: 'Get many records' },
					{ name: 'Update', value: 'update', action: 'Update a record' },
				],
				default: 'getMany',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['steps'] } },
				options: [
					{ name: 'Get', value: 'get', action: 'Get a step' },
					{ name: 'Get Many', value: 'getMany', action: 'Get many steps' },
					{ name: 'Update', value: 'update', action: 'Update a step' },
				],
				default: 'getMany',
			},
			{
				displayName: 'Record',
				name: 'recordId',
				type: 'resourceLocator',
				required: true,
				default: { mode: 'list', value: '' },
				displayOptions: { show: { resource: allResources, operation: ['get', 'update'] } },
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: { searchListMethod: 'searchRecords', searchable: true },
					},
					{ displayName: 'By ID', name: 'id', type: 'string' },
				],
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: { show: { resource: allResources, operation: ['getMany'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				description: 'Max number of results to return',
				typeOptions: { minValue: 1, maxValue: 10000 },
				displayOptions: {
					show: { resource: allResources, operation: ['getMany'], returnAll: [false] },
				},
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: creatable, operation: ['create'] } },
			},
			{
				displayName: 'Customer ID',
				name: 'customerId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['journeys'], operation: ['create'] } },
			},
			{
				displayName: 'Journey ID',
				name: 'journeyId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['playbooks'], operation: ['create'] } },
			},
			{
				displayName: 'Object ID',
				name: 'objectId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['object-records'], operation: ['create'] } },
			},
			{
				displayName: 'Fields (JSON)',
				name: 'fields',
				type: 'json',
				default: '{}',
				description: 'Additional REST fields. Sekential validates permissions and domain rules.',
				displayOptions: { show: { resource: allResources, operation: ['create', 'update'] } },
			},
		],
	};

	methods = {
		listSearch: {
			async searchRecords(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const resource = this.getNodeParameter('resource') as Resource;
				const docs = await listRecords(this, resource, 100, false, filter);
				return {
					results: docs.map((doc) => ({
						name: String(doc.name ?? doc.title ?? doc.id),
						value: String(doc.id),
					})),
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const output: INodeExecutionData[] = [];
		for (let index = 0; index < this.getInputData().length; index++) {
			try {
				const resource = this.getNodeParameter('resource', index) as Resource | 'user';
				const operation = this.getNodeParameter('operation', index) as string;
				let records: JsonObject[];
				if (resource === 'user')
					records = [unwrapDocument(await request(this, 'GET', 'users/me'), 'user')];
				else if (operation === 'getMany') {
					const returnAll = this.getNodeParameter('returnAll', index) as boolean;
					const limit = returnAll ? 100 : (this.getNodeParameter('limit', index) as number);
					records = await listRecords(this, resource, limit, returnAll);
				} else if (operation === 'get') {
					const id = recordId(this, this.getNodeParameter('recordId', index));
					records = [
						unwrapDocument(await request(this, 'GET', `${resource}/${encodeURIComponent(id)}`)),
					];
				} else if (operation === 'create' || operation === 'update') {
					if (operation === 'create' && !creatable.includes(resource))
						throw new NodeOperationError(
							this.getNode(),
							'Creation of this resource requires the Sekential flow editor',
						);
					const raw = this.getNodeParameter('fields', index);
					const parsed =
						typeof raw === 'string' ? (JSON.parse(raw) as JsonObject) : (raw as JsonObject);
					if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
						throw new NodeOperationError(this.getNode(), 'Fields must be a JSON object');
					const fields = { ...parsed };
					let path = resource;
					if (operation === 'create') {
						fields.name = this.getNodeParameter('name', index) as string;
						if (resource === 'journeys')
							fields.customer = this.getNodeParameter('customerId', index) as string;
						if (resource === 'playbooks')
							fields.journey = this.getNodeParameter('journeyId', index) as string;
						if (resource === 'object-records')
							fields.object = this.getNodeParameter('objectId', index) as string;
					} else
						path += `/${encodeURIComponent(recordId(this, this.getNodeParameter('recordId', index)))}`;
					records = [
						unwrapDocument(
							await request(
								this,
								operation === 'create' ? 'POST' : 'PATCH',
								path,
								undefined,
								fields,
							),
						),
					];
				} else throw new NodeOperationError(this.getNode(), `Unsupported operation: ${operation}`);
				for (const record of records) output.push({ json: record, pairedItem: { item: index } });
			} catch (error) {
				if (this.continueOnFail()) {
					output.push({ json: { error: (error as Error).message }, pairedItem: { item: index } });
					continue;
				}
				if (error instanceof NodeOperationError)
					throw new NodeOperationError(this.getNode(), error.message, { itemIndex: index });
				if (error instanceof NodeApiError)
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, {
						itemIndex: index,
					});
				if (error instanceof SyntaxError || (error as Error).message?.startsWith('Fields must'))
					throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: index });
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: index });
			}
		}
		return [output];
	}
}
