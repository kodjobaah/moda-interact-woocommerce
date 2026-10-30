import assert from 'node:assert/strict';

// Real WooCommerce HTTP mutations, not direct do_action() calls. The caller
// supplies snapshots of Action Scheduler's durable all-status action history.
// Action Scheduler may create a new action ID for a retry of the *same*
// checkout event. Only attempt 1 proves a fresh publication by CheckoutCapture.
// The input is the all-status action history, so pending->complete transitions
// do not make old actions disappear and then look new on a subsequent read.
export function newForKey(before, after, checkoutKey) {
	const ids = new Set(before.map((row) => String(row.id)));
	return after.filter(
		(row) =>
			!ids.has(String(row.id)) &&
			row.args?.attempt === 1 &&
			row.args?.event?.eventType === 'CHECKOUT_UPDATED' &&
			(!checkoutKey || row.args.event.checkoutKey === checkoutKey)
	);
}

function assertEmptyEvent(action, checkoutKey, earlierEventId) {
	const event = action?.args?.event;
	assert.equal(event?.eventType, 'CHECKOUT_UPDATED');
	assert.ok(
		['woo.activity.v1', 'woo.activity.v2'].includes(event.schemaVersion)
	);
	assert.equal(event.checkoutKey, checkoutKey);
	assert.notEqual(event.eventId, earlierEventId);
	assert.deepEqual(event.checkout.items, []);
	assert.equal(event.checkout.total, '0.00');
	assert.match(event.occurredAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
	return event;
}

function assertRefilled(before, after, checkoutKey, emptyAction, context) {
	const refills = newForKey(before, after, checkoutKey).filter(
		(row) => row.args.event.checkout?.items?.length > 0
	);
	assert.ok(
		refills.length > 0,
		`${context}: refill must enqueue a newer nonempty checkout`
	);
	assert.ok(
		refills.every(
			(row) =>
				row.args.event.eventId !== emptyAction.args.event.eventId &&
				BigInt(row.id) > BigInt(emptyAction.id)
		),
		`${context}: refills must not replay the empty event`
	);
	return refills;
}

async function expectHttp(response, expected, context) {
	if (response.status !== expected) {
		const detail = (await response.clone().text())
			.replace(/\s+/g, ' ')
			.slice(0, 220);
		assert.fail(
			`${context}: expected HTTP ${expected}; got ${response.status}: ${detail}`
		);
	}
}

async function cartItemKey(browser, context) {
	const result = await browser.request('/wp-json/wc/store/v1/cart');
	await expectHttp(result, 200, `${context} cart GET`);
	const cart = await result.json();
	assert.equal(
		cart.items?.length,
		1,
		`${context}: fixture cart must have one line`
	);
	assert.equal(typeof cart.items[0].key, 'string');
	return cart.items[0].key;
}

/**
 * Verify that a real, still-unkeyed guest cart never publishes an empty update.
 * The checkout page GET and the Store API customer POST exercise distinct routes.
 */
export async function assertNeverActiveEmpty({
	siteUrl,
	checkoutPage,
	getActions,
	createSession,
}) {
	const visitor = createSession(siteUrl);
	const before = getActions();
	const initial = await visitor.request('/wp-json/wc/store/v1/cart');
	await expectHttp(initial, 200, 'never-active cart GET');
	assert.deepEqual((await initial.json()).items, []);
	for (let n = 0; n < 2; n += 1) {
		const response = await visitor.request(
			'/wp-json/wc/store/v1/cart/update-customer',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					billing_address: {
						first_name: 'Never',
						last_name: 'Active',
						email: 'never-active@example.test',
						phone: '+447700900001',
						country: 'GB',
						address_1: '10 Test Street',
						city: 'London',
						postcode: 'SE1 1AA',
					},
				}),
			}
		);
		await expectHttp(
			response,
			200,
			'never-active Store API update-customer'
		);
	}
	const classic = await visitor.request(`/?page_id=${checkoutPage}`);
	assert.ok(
		[200, 301, 302, 303].includes(classic.status),
		`never-active Classic checkout GET: HTTP ${classic.status}`
	);
	assert.deepEqual(
		newForKey(before, getActions()),
		[],
		'never-active Store API/Classic empty requests must not publish checkout activity'
	);
	process.stdout.write(
		'ARCH-048 never-active empty Store API/Classic requests PASS\n'
	);
}

/**
 * Classic checkout is keyed by the caller's real update_order_review AJAX.
 * Clearing uses WooCommerce's wc-ajax=remove_from_cart endpoint, rather than
 * invoking the removal hook directly. Cart GET is only used to obtain the key.
 */
export async function assertClassicClearRefill({
	kind,
	browser,
	productId,
	reviewNonce,
	reviewBody,
	initialEvent,
	getActions,
}) {
	const context = `${kind} Classic`;
	const checkoutKey = initialEvent.checkoutKey;
	const itemKey = await cartItemKey(browser, context);
	const before = getActions();
	const removal = () =>
		browser.request('/?wc-ajax=remove_from_cart', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ cart_item_key: itemKey }).toString(),
		});
	await expectHttp(await removal(), 200, `${context} AJAX remove`);
	const cleared = getActions();
	const empty = newForKey(before, cleared, checkoutKey);
	assert.equal(
		empty.length,
		1,
		`${context}: must publish exactly one empty transition`
	);
	assertEmptyEvent(empty[0], checkoutKey, initialEvent.eventId);
	// A second remove request and an empty checkout review must be no-ops.
	await expectHttp(await removal(), 200, `${context} repeated AJAX remove`);
	const review = () =>
		browser.request('/?wc-ajax=update_order_review', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				security: reviewNonce,
				post_data: reviewBody,
			}).toString(),
		});
	await expectHttp(await review(), 200, `${context} empty checkout review`);
	assert.deepEqual(
		newForKey(cleared, getActions(), checkoutKey),
		[],
		`${context}: repeated empty requests must not publish`
	);
	const refilledBefore = getActions();
	const add = await browser.request(`/?add-to-cart=${productId}`);
	assert.ok(
		[200, 302].includes(add.status),
		`${context}: refill HTTP ${add.status}`
	);
	await expectHttp(
		await review(),
		200,
		`${context} refilled checkout review`
	);
	assertRefilled(
		refilledBefore,
		getActions(),
		checkoutKey,
		empty[0],
		context
	);
	process.stdout.write(
		`ARCH-048 ${context}: clear once, repeat no-op, refill with same key PASS\n`
	);
}

/**
 * Blocks: Store API remove-item mutates the cart and triggers the Woo removal
 * hooks; update-customer is used for repeated empty observations. The checkout
 * PATCH after add-item verifies the resumed checkout still has its original key.
 */
export async function assertStoreApiClearRefill({
	kind,
	browser,
	productId,
	checkoutBody,
	initialEvent,
	getActions,
}) {
	const context = `${kind} Store API`;
	const checkoutKey = initialEvent.checkoutKey;
	const itemKey = await cartItemKey(browser, context);
	const before = getActions();
	const removed = await browser.request(
		'/wp-json/wc/store/v1/cart/remove-item',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ key: itemKey }),
		}
	);
	await expectHttp(removed, 200, `${context} remove-item`);
	assert.deepEqual(
		(await removed.json()).items,
		[],
		`${context}: cart really cleared`
	);
	const cleared = getActions();
	const empty = newForKey(before, cleared, checkoutKey);
	assert.equal(
		empty.length,
		1,
		`${context}: must publish exactly one empty transition`
	);
	assertEmptyEvent(empty[0], checkoutKey, initialEvent.eventId);
	for (let n = 0; n < 2; n += 1) {
		const response = await browser.request(
			'/wp-json/wc/store/v1/cart/update-customer',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					billing_address: checkoutBody.billing_address,
				}),
			}
		);
		await expectHttp(response, 200, `${context} empty update-customer`);
	}
	assert.deepEqual(
		newForKey(cleared, getActions(), checkoutKey),
		[],
		`${context}: repeated empty Store API requests must not publish`
	);
	const refillBefore = getActions();
	const refill = await browser.request('/wp-json/wc/store/v1/cart/add-item', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ id: productId, quantity: 1 }),
	});
	await expectHttp(refill, 201, `${context} refill add-item`);
	const patch = await browser.request('/wp-json/wc/store/v1/checkout', {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(checkoutBody),
	});
	await expectHttp(patch, 200, `${context} refilled checkout PATCH`);
	assertRefilled(refillBefore, getActions(), checkoutKey, empty[0], context);
	process.stdout.write(
		`ARCH-048 ${context}: clear once, repeat no-op, refill with same key PASS\n`
	);
}
