export function categoriesFixture() {
	return {
		schemaVersion: 1,
		requestedLocale: 'en_GB',
		resolvedLocale: 'en',
		categories: [
			{
				id: 'fashion',
				slug: 'fashion',
				localizedDisplayName: 'Fashion',
				localizedDescription: 'Clothing and accessories',
				mappings: [
					{
						id: 'clothing',
						conditionKey: 'is_clothing',
						localizedDisplayName: 'Clothing',
					},
				],
				defaultTemplate: {
					id: 'template_1',
					key: 'fashion',
					displayName: 'Fashion',
					editVersion: 1,
				},
			},
			{
				id: 'electronics',
				slug: 'electronics',
				localizedDisplayName: 'Electronics',
				localizedDescription: 'Electronics and gadgets',
				mappings: [],
				defaultTemplate: {
					id: 'template_2',
					key: 'electronics',
					displayName: 'Electronics',
					editVersion: 1,
				},
			},
		],
		storeProfile: {
			activeCategory: null,
			pendingCategory: null,
			activeMappingIds: [],
			pendingMappingIds: [],
			pendingSelectionGeneration: 0,
			pendingSelectedAt: null,
			pendingState: 'NONE',
			pendingTemplate: null,
		},
	};
}

export function selectedFixture() {
	return {
		schemaVersion: 1,
		activeCategoryId: 'fashion',
		activePromptRevisionId: 'revision_1',
		activeMappingIds: ['clothing'],
		pendingSelectionGeneration: 1,
	};
}
