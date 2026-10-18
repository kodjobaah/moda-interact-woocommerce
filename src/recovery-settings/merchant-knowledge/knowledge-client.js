// ARCH-035 is UI-only. The archived hosted API-004/005 definitions were
// superseded: there is no approved Woo source or upload proxy to call.
// Keep fixture adapters injectable for view tests, never attempt a Shopify URL.
export function createMerchantKnowledgeClient() {
	return {
		read: async () => {
			throw Object.assign(new Error('KNOWLEDGE_UNAVAILABLE'), {
				code: 'KNOWLEDGE_UNAVAILABLE',
			});
		},
	};
}

// Browser-side defence in depth, not a substitute for server-side SSRF checks.
export function validKnowledgeUrl(value) {
	try {
		const url = new URL(value);
		const hostname = url.hostname.toLowerCase();
		const clean = value.trim();
		return (
			url.protocol === 'https:' &&
			!url.port &&
			!!hostname &&
			hostname.includes('.') &&
			!hostname.includes('[') &&
			!hostname.includes(']') &&
			!url.username &&
			!url.password &&
			!url.hash &&
			!['localhost', '0.0.0.0', '::1', '[::1]'].includes(hostname) &&
			!hostname.endsWith('.local') &&
			!hostname.endsWith('.localhost') &&
			!hostname.endsWith('.internal') &&
			!hostname.endsWith('.test') &&
			!hostname.endsWith('.invalid') &&
			!/^\d+(?:\.\d+)*$/.test(hostname) &&
			!/^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2[0-9]|3[01])\./.test(
				hostname
			) &&
			clean.length <= 2048
		);
	} catch {
		return false;
	}
}

// File selection validation cannot grant upload permission or an R2 URL.
export function validKnowledgeFile(file, maxBytes, formatKey) {
	return (
		!!file &&
		(formatKey === 'CSV' || formatKey === 'XLSX'
			? (file.name ?? '')
					.toLowerCase()
					.endsWith(`.${formatKey.toLowerCase()}`)
			: /\.(csv|xlsx)$/i.test(file.name ?? '')) &&
		Number.isSafeInteger(file.size) &&
		file.size > 0 &&
		Number.isSafeInteger(maxBytes) &&
		maxBytes > 0 &&
		file.size <= maxBytes
	);
}
