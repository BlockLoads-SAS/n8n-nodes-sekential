type RequestError = {
	statusCode?: number | string;
	httpCode?: number | string;
	response?: { status?: number; headers?: Record<string, string | number | undefined> };
	cause?: RequestError;
	errorResponse?: RequestError;
};

export function requestErrorDetails(error: unknown): { status: number; retryAfter: number } {
	const failure = error && typeof error === 'object' ? (error as RequestError) : {};
	// n8n wraps HTTP failures in NodeApiError and retains the response on its cause.
	const original = failure.cause ?? failure.errorResponse;
	return {
		status: Number(
			failure.statusCode ??
				failure.httpCode ??
				failure.response?.status ??
				original?.statusCode ??
				original?.httpCode ??
				original?.response?.status,
		),
		retryAfter: Number(
			failure.response?.headers?.['retry-after'] ?? original?.response?.headers?.['retry-after'],
		),
	};
}
