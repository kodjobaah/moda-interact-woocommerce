/**
 * Read-only reconciliation after an uncertain category POST outcome.
 * Generation is the concurrency fence; never infer a successful write from a
 * matching category alone or retry the mutation automatically.
 *
 * @param {Object} latest    - Latest server category readback.
 * @param {Object} previous  - Category state before the Save attempt.
 * @param {Object} selection - Requested category and mapping IDs.
 */
export function reconcileStoreCategorySave(latest, previous, selection) {
	const generation = latest.storeProfile.pendingSelectionGeneration;
	const previousGeneration = previous.storeProfile.pendingSelectionGeneration;
	if (generation > previousGeneration) {
		const profile = latest.storeProfile;
		const activeMatches =
			profile.activeCategory?.id === selection.categoryId;
		const actual = [...profile.activeMappingIds].sort();
		const desired = [...selection.mappingIds].sort();
		return activeMatches &&
			actual.length === desired.length &&
			actual.every((id, index) => id === desired[index])
			? 'SAVED'
			: 'CONFLICT';
	}

	const profile = latest.storeProfile;
	const previousProfile = previous.storeProfile;
	if (
		generation !== previousGeneration ||
		profile.activeCategory?.id !== previousProfile.activeCategory?.id ||
		!sameIds(profile.activeMappingIds, previousProfile.activeMappingIds) ||
		profile.pendingCategory?.id !== previousProfile.pendingCategory?.id ||
		!sameIds(profile.pendingMappingIds, previousProfile.pendingMappingIds)
	) {
		return 'CONFLICT';
	}
	const selectedCategory = latest.categories.find(
		(category) => category.id === selection.categoryId
	);
	if (
		!selectedCategory ||
		selection.mappingIds.some(
			(id) =>
				!selectedCategory.mappings.some((mapping) => mapping.id === id)
		)
	) {
		return 'CATEGORY_UNAVAILABLE';
	}
	return 'SAVE_FAILED';
}

function sameIds(left, right) {
	const first = [...left].sort();
	const second = [...right].sort();
	return (
		first.length === second.length &&
		first.every((id, index) => id === second[index])
	);
}

/**
 * Resolve an ambiguous HTTP failure against a fresh GET without a second POST.
 *
 * @param {Object} controller - Store-category controller and state.
 * @param {number} revision   - Generation of the in-flight Save operation.
 * @param {Object} previous   - Category state before the Save attempt.
 * @param {Object} selection  - Requested category and mapping IDs.
 */
export async function verifyStoreCategorySave(
	controller,
	revision,
	previous,
	selection
) {
	controller.publish({ ...controller.state, status: 'VERIFYING' });
	let latest;
	try {
		latest = await controller.client.read();
	} catch (error) {
		if (!controller.isCurrent(revision)) {
			return;
		}
		if (
			[
				'RECONNECT_REQUIRED',
				'SITE_URL_CHANGED',
				'LOCAL_STATE_INVALID',
			].includes(error?.message)
		) {
			controller.failure(error);
		} else {
			controller.publish({
				...controller.state,
				status: 'VERIFY_REQUIRED',
			});
		}
		return;
	}
	if (!controller.isCurrent(revision)) {
		return;
	}
	const outcome = reconcileStoreCategorySave(latest, previous, selection);
	if (outcome === 'SAVE_FAILED') {
		controller.publish({
			...controller.state,
			data: latest,
			status: outcome,
		});
		return;
	}
	controller.publish(controller.fromRead(latest, outcome));
	if (outcome === 'SAVED') {
		try {
			await controller.onSaved();
		} catch {
			/* Overview has independent refresh/error feedback. */
		}
	}
}
