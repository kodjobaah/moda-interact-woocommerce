/**
 * ARCH-035-WOOCOMMERCE-003 has no approved feature-preference REST facade.
 * Keep the transport absent rather than guessing a hosted URL or pretending a
 * successful toggle changed persistent merchant state.
 *
 * Tests may inject an adapter into FeaturePreferencesController. Production
 * must not use those fixtures to display authoritative entitlements.
 */
export function createFeaturePreferencesClient() {
	return {
		read: async () => {
			throw new Error('FEATURES_UNAVAILABLE');
		},
		save: async () => {
			throw new Error('FEATURES_UNAVAILABLE');
		},
	};
}

/** Strictly validate the projection before presenting it as plan authority. */
export function parseFeaturePreferences(value) {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		typeof value.revision !== 'string' ||
		!value.revision ||
		!Array.isArray(value.features) ||
		value.features.length > 1000
	) {
		throw new Error('FEATURES_INVALID');
	}
	const ids = new Set();
	for (const feature of value.features) {
		if (
			!feature ||
			typeof feature.id !== 'string' ||
			!feature.id ||
			ids.has(feature.id) ||
			typeof feature.key !== 'string' ||
			typeof feature.name !== 'string' ||
			!feature.name ||
			(feature.description !== null &&
				typeof feature.description !== 'string') ||
			!['enabled', 'effective', 'editable'].every(
				(key) => typeof feature[key] === 'boolean'
			)
		) {
			throw new Error('FEATURES_INVALID');
		}
		ids.add(feature.id);
	}
	return value;
}
