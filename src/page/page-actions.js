// Map page events onto the existing domain controllers without transport in React.
export function createPageActions(sessionRef, setActiveSurface) {
	const controllers = () => sessionRef.current?.controllers;
	return {
		connect: () => controllers()?.connection.connect(),
		retryConnection: () => controllers()?.connection.refresh(),
		refreshMerchant: () => controllers()?.merchant.refresh(),
		syncStoreContext: () => controllers()?.sync.sync(),
		refreshBilling: () => controllers()?.billing.refresh(),
		loadPlans: () => controllers()?.billing.loadPlans(),
		selectPlan: (plan) => controllers()?.billing.createOrSwitch(plan),
		cancelPlan: () => controllers()?.billing.cancel(),
		setBillingView: (view) => controllers()?.billing.setView(view),
		refreshCategory: () => controllers()?.category.refresh(),
		chooseCategory: (categoryId) =>
			controllers()?.category.chooseCategory(categoryId),
		toggleMapping: (mappingId) =>
			controllers()?.category.toggleMapping(mappingId),
		saveCategory: () => controllers()?.category.save(),
		selectSurface: (surface) => {
			setActiveSurface(surface);
			controllers()?.billing.setActive(surface === 'BILLING');
			if (surface === 'RECOVERY') {
				controllers()?.category.refresh();
			}
		},
	};
}
