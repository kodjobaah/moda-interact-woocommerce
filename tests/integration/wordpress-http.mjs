/**
 * Keep wp-env REST assertions independent of stale HTTP keep-alive sockets.
 * Describe network failures without exposing session cookies, nonce or query data.
 * Deliberately do not retry: several test GETs advance stateful fixture responses.
 *
 * @param {typeof fetch} fetchImpl - Fetch implementation or test transport.
 */
export function createWordPressFetch(fetchImpl = fetch) {
	return async (url, options = {}) => {
		const headers = new Headers(options.headers);
		headers.set('connection', 'close');

		try {
			return await fetchImpl(url, { ...options, headers });
		} catch (error) {
			const method = options.method ?? 'GET';
			const path = new URL(url).pathname;
			const code = error?.cause?.code ?? 'unknown';
			throw new Error(
				`WordPress HTTP transport failed: ${method} ${path} (${code})`,
				{ cause: error }
			);
		}
	};
}
