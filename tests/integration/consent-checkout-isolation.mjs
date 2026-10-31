import assert from 'node:assert/strict';

/**
 * Read-only check on durable checkout events for this scenario's disposable
 * product. Do not compare global pending-action counts: older test jobs may
 * complete, retry or become pending independently while Store API runs.
 *
 * A retry of an existing eventId is not a new checkout snapshot. A genuinely
 * new eventId for this product IS a regression, even if Action Scheduler has
 * already completed the action by the time we query its history.
 */
export function assertNoConsentCheckoutActivity({
	before,
	after,
	productId,
	context,
}) {
	assert.ok(Array.isArray(before) && Array.isArray(after));
	assert.match(String(productId), /^[1-9][0-9]*$/);
	const matchesProduct = (action) => {
		const event = action?.args?.event;
		return (
			event?.eventType === 'CHECKOUT_UPDATED' &&
			Array.isArray(event.checkout?.items) &&
			event.checkout.items.some(
				(item) => String(item?.productId) === String(productId)
			)
		);
	};
	const existingEventIds = new Set(
		before.filter(matchesProduct).map(({ args }) => args.event.eventId)
	);
	const newActions = after
		.filter(matchesProduct)
		.filter(({ args }) => !existingEventIds.has(args.event.eventId))
		.map(({ id, args }) => ({
			actionId: String(id),
			eventId: args.event.eventId,
		}))
		.sort((a, b) => a.actionId.localeCompare(b.actionId));
	assert.deepEqual(
		newActions,
		[],
		`${context}: consent must not create checkout activity for this fixture cart`
	);
}
