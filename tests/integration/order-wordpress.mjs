import assert from 'node:assert/strict';

// Real Woo Store API order lifecycle assertions, kept separate from cart and
// checkout mechanics. The fixture API observes the actual WordPress publisher.
function orderEvents(rows, orderId, eventType) {
	return rows.filter(
		(row) =>
			row.args?.event?.order?.orderId === String(orderId) &&
			(!eventType || row.args.event.eventType === eventType)
	);
}

export async function assertOrderWordPress({
	kind,
	orderId,
	checkoutKey,
	beforeOrder,
	checkoutAction,
	getActions,
	newActions,
	deliverAction,
	wpAsync,
	getActivityRequests,
	setActivityStatus,
}) {
	// The placed hook fires before payment, so creation must emit only
	// ORDER_PLACED. The same order identity is stored through WC_Order APIs.
	const afterOrder = getActions();
	const placedActions = orderEvents(
		newActions(beforeOrder, afterOrder),
		orderId,
		'ORDER_PLACED'
	);
	assert.equal(placedActions.length, 1, `${kind}: one placed event`);
	const placedAction = placedActions[0];
	assert.equal(placedAction.args.event.checkoutKey, checkoutKey);
	assert.equal(placedAction.args.event.order.checkoutKey, checkoutKey);
	assert.equal(placedAction.args.event.order.orderId, String(orderId));
	assert.equal(placedAction.args.event.schemaVersion, 'woo.activity.v1');
	assert.equal(
		orderEvents(afterOrder, orderId, 'ORDER_PAID').length,
		0,
		`${kind}: placing an order must not imply successful payment`
	);
	// Order-first and checkout-first are both valid ingestion orders. The
	// fixture intentionally alternates delivery for guest and customer.
	const earlierCheckout = checkoutAction;
	const deliveryOrder =
		kind === 'guest'
			? [placedAction, earlierCheckout]
			: [earlierCheckout, placedAction];
	for (const action of deliveryOrder) {
		await deliverAction(action);
		assert.ok(
			getActivityRequests().some(
				(request) =>
					request.eventId === action.args.event.eventId &&
					request.status === 202
			),
			`${kind}: activity API must accept either source order`
		);
	}
	// In real WooCommerce, COD moves an unpaid order into processing. Woo may
	// also set date_paid automatically: neither state confirms money was taken.
	await wpAsync(
		'eval',
		`
		$order = wc_get_order(${Number(orderId)});
		$order->update_status('on-hold');
	`
	);
	assert.equal(
		orderEvents(getActions(), orderId, 'ORDER_PAID').length,
		0,
		`${kind}: on-hold is not proof of collection`
	);
	await wpAsync(
		'eval',
		`
		$order = wc_get_order(${Number(orderId)});
		$order->update_status('processing');
	`
	);
	assert.equal(
		orderEvents(getActions(), orderId, 'ORDER_PAID').length,
		0,
		`${kind}: COD processing without payment evidence remains unpaid`
	);
	// Actual payment_complete() is a Woo-authoritative confirmation even when
	// the gateway supplies no transaction reference. COD's payment-complete
	// status filter normally moves the order to completed.
	await wpAsync(
		'eval',
		`
		$order = wc_get_order(${Number(orderId)});
		$order->update_status('pending');
		if (!$order->payment_complete()) throw new Exception('COD payment_complete failed');
	`
	);
	const afterPaid = getActions();
	const paid = orderEvents(
		newActions(afterOrder, afterPaid),
		orderId,
		'ORDER_PAID'
	);
	assert.equal(paid.length, 1, `${kind}: confirmed COD payment must emit once`);
	assert.equal(paid[0].args.event.checkoutKey, checkoutKey);

	// A gateway that does not call payment_complete() can still prove payment
	// by saving a transaction reference before its paid-status transition.
	// Use a linked, HPOS-backed order to test the actual WordPress hook path.
	const statusGatewayId = Number(
		(
			await wpAsync(
				'eval',
				`
				$order = wc_create_order();
				$order->set_payment_method('arch048-confirmed-gateway');
				$order->update_meta_data('_moda_checkout_key', ${JSON.stringify(checkoutKey)});
				$order->save();
				do_action('woocommerce_checkout_order_processed', $order->get_id(), array(), $order);
				$order->set_transaction_id('arch048-confirmed-gateway-transaction');
				$order->save();
				$order->update_status('processing');
				echo $order->get_id();
			`
			)
		).trim()
	);
	assert.ok(Number.isSafeInteger(statusGatewayId) && statusGatewayId > 0);
	try {
		const statusGatewayPaid = orderEvents(
			getActions(),
			statusGatewayId,
			'ORDER_PAID'
		);
		assert.equal(
			statusGatewayPaid.length,
			1,
			`${kind}: transaction-backed status-only gateway emits paid`
		);
		assert.equal(statusGatewayPaid[0].args.event.checkoutKey, checkoutKey);
		await wpAsync(
			'eval',
			`do_action('woocommerce_payment_complete', ${statusGatewayId});`
		);
		assert.equal(
			orderEvents(getActions(), statusGatewayId, 'ORDER_PAID').length,
			1,
			`${kind}: later payment callback deduplicates gateway status evidence`
		);
	} finally {
		await wpAsync('eval', `wc_get_order(${statusGatewayId})->delete(true);`);
	}
	// Woo's payment-complete and payment-status callbacks must reuse this event.
	await wpAsync(
		'eval',
		`
		$order = wc_get_order(${Number(orderId)});
		$order->update_status('pending');
		if (!$order->payment_complete()) throw new Exception('repeat payment_complete failed');
	`
	);
	assert.equal(
		orderEvents(getActions(), orderId, 'ORDER_PAID').length,
		1,
		`${kind}: payment_complete after a paid transition must deduplicate`
	);
	await wpAsync(
		'eval',
		`do_action('woocommerce_payment_complete', ${Number(orderId)});`
	);
	assert.equal(
		orderEvents(getActions(), orderId, 'ORDER_PAID').length,
		1,
		`${kind}: repeated payment callback must not duplicate the event`
	);
	// Cancellation is an explicit Woo status transition, not inferred
	// from payment status or an order's existence.
	const beforeCancel = getActions();
	const callsBeforeCancel = getActivityRequests().length;
	setActivityStatus(503);
	await wpAsync(
		'eval',
		`wc_get_order(${Number(orderId)})->update_status('cancelled');`
	);
	assert.equal(
		getActivityRequests().length,
		callsBeforeCancel,
		'Cancelling an order must never call hosted API synchronously'
	);
	const afterCancel = getActions();
	const cancelled = orderEvents(
		newActions(beforeCancel, afterCancel),
		orderId,
		'ORDER_CANCELLED'
	);
	assert.equal(cancelled.length, 1, `${kind}: cancelled event`);
	const cancelAction = cancelled[0];
	assert.equal(cancelAction.args.event.checkoutKey, checkoutKey);
	await deliverAction(cancelAction);
	assert.ok(
		getActivityRequests().some(
			(request) =>
				request.eventId === cancelAction.args.event.eventId &&
				request.status === 503
		),
		'Order 503 must reach the HTTPS fixture'
	);
	const pendingRetry = orderEvents(
		getActions(),
		orderId,
		'ORDER_CANCELLED'
	).find(
		(action) =>
			Number(action.args.attempt) === 2 &&
			action.args.event.eventId === cancelAction.args.event.eventId
	);
	assert.ok(pendingRetry, 'Order 503 schedules the original event');
	assert.deepEqual(pendingRetry.args.event, cancelAction.args.event);
	setActivityStatus(202);
	await deliverAction(pendingRetry);
	assert.ok(
		getActivityRequests().some(
			(request) =>
				request.eventId === cancelAction.args.event.eventId &&
				request.status === 202
		),
		'Order retry must be accepted with its original identity'
	);
	// Repeated source callback stays suppressed, while reopening followed
	// by a new cancellation creates a genuinely new event identity.
	await wpAsync(
		'eval',
		`
		$order = wc_get_order(${Number(orderId)});
		do_action('woocommerce_order_status_changed', $order->get_id(), 'processing', 'cancelled', $order);
	`
	);
	assert.equal(
		orderEvents(getActions(), orderId, 'ORDER_CANCELLED').filter(
			(action) => Number(action.args.attempt) === 1
		).length,
		1,
		`${kind}: repeated cancelled callback must not duplicate event`
	);
	await wpAsync(
		'eval',
		`
		$order = wc_get_order(${Number(orderId)});
		$order->update_status('pending');
		$order->update_status('cancelled');
	`
	);
	const allCancellationEvents = orderEvents(
		getActions(),
		orderId,
		'ORDER_CANCELLED'
	).filter((action) => Number(action.args.attempt) === 1);
	assert.equal(
		allCancellationEvents.length,
		2,
		`${kind}: cancellation after reopening is another occurrence`
	);
	assert.notEqual(
		allCancellationEvents[0].args.event.eventId,
		allCancellationEvents[1].args.event.eventId
	);
	await wpAsync(
		'eval',
		`
		$order = wc_get_order(${Number(orderId)});
		$order->update_status('failed');
		$order->update_status('refunded');
		do_action('woocommerce_payment_complete', $order->get_id());
	`
	);
	assert.equal(
		orderEvents(getActions(), orderId, 'ORDER_PAID').length,
		1,
		`${kind}: failed/refunded and a stray payment callback cannot reverse confirmed prior state`
	);
	process.stdout.write(
		`ARCH-048 Order ${kind}: COD unpaid guard, confirmed payment, status-only gateway, cancellation, replay, 503, HPOS PASS\n`
	);
}
