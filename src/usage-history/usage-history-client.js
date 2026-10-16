/**
 * The Woo hosted API currently exposes billing purchase history and capacity,
 * not billed usage events. Do not guess a WordPress REST path or call Moda from
 * the browser. Replace only after an approved server-side proxy exists.
 */
export function createUsageHistoryClient() {
	return {
		available: false,
		getHistory: async () => {
			throw new Error('usage_history_unavailable');
		},
	};
}
