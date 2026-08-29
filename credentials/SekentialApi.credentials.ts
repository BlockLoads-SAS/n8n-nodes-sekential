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
			baseURL: 'https://app.sekential.com/api',
			url: '/users/me',
			method: 'GET',
		},
	};
}
