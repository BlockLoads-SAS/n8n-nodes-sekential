import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SekentialApi implements ICredentialType {
	name = 'sekentialApi';

	displayName = 'Sekential API';

	icon = 'file:../nodes/Sekential/sekential.svg' as const;

	documentationUrl =
		'https://github.com/BlockLoads-SAS/n8n-nodes-sekential?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Tenant URL',
			name: 'tenantUrl',
			type: 'string',
			required: true,
			default: '',
			placeholder: 'https://my-tenant.sekential.com',
			description: 'URL of the Sekential tenant that owns the API key',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-sekential-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			url: '={{$credentials.tenantUrl.replace(/\\/$/, "")}}/api/n8n/connection',
			method: 'GET',
		},
	};
}
