/**
 * The PUT store-context snapshot is versioned; the bootstrap read model is not.
 * Project only the four allowed internationalContext fields into the mock API.
 */
export function bootstrapInternationalContext(savedContext) {
	const context = savedContext ?? {
		storeLocale: 'pt_BR',
		languageTag: null,
		timeZone: 'Europe/Lisbon',
		countryCode: 'PT',
	};
	return {
		storeLocale: context.storeLocale,
		languageTag: context.languageTag,
		timeZone: context.timeZone,
		countryCode: context.countryCode,
	};
}
