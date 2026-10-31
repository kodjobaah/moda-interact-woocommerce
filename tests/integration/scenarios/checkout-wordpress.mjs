import assert from 'node:assert/strict';
import { assertOrderWordPress } from './order-wordpress.mjs';
import {
	newForKey,
	assertNeverActiveEmpty,
	assertClassicClearRefill,
	assertStoreApiClearRefill,
} from './checkout-clear-refill-wordpress.mjs';

// Real HTTP checkout sessions; unlike the PHPUnit hook doubles these requests
// pass through WooCommerce's cart, checkout and Store API controllers.
export function session(siteUrl, initialCookie = '', fetchImpl = fetch) {
	const cookies = new Map();
	for (const part of initialCookie.split(';')) {
		const index = part.indexOf('=');
		if (index > 0) {
			cookies.set(
				part.slice(0, index).trim(),
				part.slice(index + 1).trim()
			);
		}
	}
	let nonce;
	async function request(path, options = {}) {
		let url = new URL(path, siteUrl);
		const origin = new URL(siteUrl).origin;
		// Follow only same-origin GET redirects. WooCommerce and WordPress may
		// canonicalise checkout URLs, but a test must never follow an off-site URL.
		for (let redirects = 0; redirects <= 5; redirects += 1) {
			const headers = new Headers(options.headers);
			if (cookies.size) {
				headers.set(
					'cookie',
					[...cookies].map(([k, v]) => `${k}=${v}`).join('; ')
				);
			}
			if (nonce) {
				headers.set('nonce', nonce);
			}
			// Match the main WordPress test client: avoid stale keep-alive sockets
			// without retrying state-changing checkout requests.
			headers.set('connection', 'close');
			const stage = `${(options.method ?? 'GET').toUpperCase()} ${url.pathname}`;
			let response;
			try {
				response = await fetchImpl(url, {
					...options,
					headers,
					redirect: 'manual',
				});
			} catch (error) {
				// This CLI integration harness reports transport failures to stderr.
				// eslint-disable-next-line no-console
				console.error('[ARCH035] Checkout transport failure', {
					stage,
					name: error.name,
					causeCode: error.cause?.code,
					causeMessage: error.cause?.message,
				});
				throw error;
			}
			process.stdout.write(
				`[ARCH035] Checkout ${stage} -> ${response.status}\n`
			);
			const nextNonce = response.headers.get('nonce');
			if (nextNonce) {
				nonce = nextNonce;
			}
			const setCookies =
				response.headers.getSetCookie?.() ??
				[response.headers.get('set-cookie')].filter(Boolean);
			for (const line of setCookies) {
				const pair = line.split(';', 1)[0];
				const pos = pair.indexOf('=');
				if (pos > 0) {
					cookies.set(pair.slice(0, pos), pair.slice(pos + 1));
				}
			}
			if (
				![301, 302, 303, 307, 308].includes(response.status) ||
				(options.method ?? 'GET').toUpperCase() !== 'GET'
			) {
				return response;
			}
			const location = response.headers.get('location');
			assert.ok(
				location,
				`HTTP ${response.status} redirect missing Location header`
			);
			const target = new URL(location, url);
			assert.equal(
				target.origin,
				origin,
				'Checkout redirected outside the WordPress origin'
			);
			assert.ok(
				redirects < 5,
				'Checkout exceeded five same-origin redirects'
			);
			url = target;
		}
	}
	return { request };
}

function classicReviewNonce(html) {
	// WooCommerce prints this in wc_checkout_params; attribute-escaped JSON is
	// also accepted when optimisation plugins transform inline script markup.
	const script = html
		.replace(/&quot;|&#34;/g, '"')
		.replace(/&#039;|&#39;/g, "'");
	return (
		script.match(
			/["']update_order_review_nonce["']\s*:\s*["']([a-zA-Z0-9]+)["']/
		)?.[1] ?? null
	);
}

async function assertHttpOk(response, context) {
	if (response.status !== 200) {
		const excerpt = (await response.clone().text())
			.replace(/\s+/g, ' ')
			.slice(0, 350);
		assert.fail(
			`${context}: expected HTTP 200, received ${response.status}; body: ${excerpt}`
		);
	}
}

// Exercise the published Action Scheduler callback without changing its retry
// delay. Checkout and order tests share the same queued delivery contract.
export async function deliverCapturedAction(wpAsync, action) {
	const args = Buffer.from(JSON.stringify(action.args)).toString('base64');
	await wpAsync(
		'eval',
		`do_action('moda_interact_dispatch_checkout_activity', ...array_values(json_decode(base64_decode('${args}'), true)));`
	);
}

// Execute only the selected persisted action through Action Scheduler itself.
// A batch-level `action-scheduler run` can pick other older checkout events.
export async function runScheduledCheckoutAction(wpAsync, action) {
	const id = String(action?.id ?? '');
	assert.match(id, /^[1-9][0-9]*$/, 'Scheduled action ID is invalid');
	await wpAsync('action-scheduler', 'action', 'run', id);
}

// A 503 from *another* queued event does not prove that this event was retried.
// Slice the fixture requests at the dispatch boundary before calling this helper.
export function assertActivityRequestForEvent(
	requests,
	eventId,
	expectedStatus,
	context
) {
	const matches = requests.filter((request) => request.eventId === eventId);
	assert.equal(
		matches.length,
		1,
		`${context}: expected one HTTPS request for event ${eventId}, observed ${matches.length}`
	);
	assert.equal(
		matches[0].status,
		expectedStatus,
		`${context}: event ${eventId} must receive HTTP ${expectedStatus}`
	);
}

// Checkout PATCH observes the current checkout, but WooCommerce Blocks saves
// billing fields through the separate Store API cart/update-customer endpoint.
export async function persistBlocksBilling(blocks, billingAddress, kind) {
	const response = await blocks.request(
		'/wp-json/wc/store/v1/cart/update-customer',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ billing_address: billingAddress }),
		}
	);
	assert.equal(
		response.status,
		200,
		`${kind}: cart/update-customer must succeed (HTTP ${response.status})`
	);
	const updatedCart = await response.json();
	assert.ok(
		updatedCart?.billing_address?.first_name ===
			billingAddress.first_name &&
			updatedCart?.billing_address?.last_name ===
				billingAddress.last_name,
		`${kind}: cart/update-customer must persist billing fields`
	);
}

function checkoutEvents(rows) {
	return rows.filter(
		(row) => row.args?.event?.eventType === 'CHECKOUT_UPDATED'
	);
}

// Action Scheduler's pending list is not an insertion-ordered event stream.
// Select actions by their stable IDs, not by the last array position.
export function newCheckoutActions(before, after) {
	const existingIds = new Set(before.map((row) => String(row.id)));
	return after.filter((row) => !existingIds.has(String(row.id)));
}

function newestAction(rows) {
	return rows.reduce(
		(newest, row) =>
			newest === null || BigInt(row.id) > BigInt(newest.id)
				? row
				: newest,
		null
	);
}

// Diagnostics contain only action IDs and booleans; never log checkout PII.
function changedCheckoutDiagnostic(
	before,
	after,
	expectedName,
	responseMatches
) {
	const added = newForKey(before, after);
	return JSON.stringify({
		storeApiResponseMatchesUpdatedName: responseMatches,
		actionIdsBefore: before.map((row) => row.id),
		actionIdsAfter: after.map((row) => row.id),
		newActionIds: added.map((row) => row.id),
		updatedNameInNewQueuedSnapshot: added.some(
			(row) =>
				row.args?.event?.checkout?.contact?.firstName === expectedName
		),
	});
}

function assertEvent(event) {
	assert.equal(event.schemaVersion, 'woo.activity.v1');
	assert.equal(event.eventType, 'CHECKOUT_UPDATED');
	assert.match(event.eventId, /^woo-[0-9a-f]{32}$/);
	assert.match(event.checkoutKey, /^woo-[0-9a-f]{32}$/);
	assert.match(event.checkout.currency, /^[A-Z]{3}$/);
	assert.ok(Number(event.checkout.total) >= 0);
	assert.ok(event.checkout.items?.length > 0);
	assert.equal(event.checkout.restoration?.schemaVersion, 'woo.cart-restore.v1');
	assert.ok(['supported', 'unsupported'].includes(event.checkout.restoration?.kind));
	if (event.checkout.restoration.kind === 'supported') {
		assert.ok(Array.isArray(event.checkout.restoration.appliedCouponCodes));
		assert.ok(event.checkout.restoration.lines.length > 0);
	}
}

async function addVariableCartAndCoupon(browser, fixture, kind) {
	const cartResponse = await browser.request('/wp-json/wc/store/v1/cart');
	assert.equal(cartResponse.status, 200, `${kind}: initialize Store API cart session`);
	let response = await browser.request('/wp-json/wc/store/v1/cart/add-item', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			id: fixture.variableProduct,
			quantity: 1,
			variation: [{ attribute: 'Size', value: 'Large' }],
		}),
	});
	assert.equal(response.status, 201, `${kind}: variable variation add-item`);
	response = await browser.request('/wp-json/wc/store/v1/cart/apply-coupon', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ code: fixture.couponCode }),
	});
	assert.equal(response.status, 200, `${kind}: apply original Woo coupon`);
}

function assertSupportedVariationAndCoupon(event, fixture, kind) {
	assertEvent(event);
	const snapshot = event.checkout.restoration;
	assert.equal(snapshot.kind, 'supported', `${kind}: native variable cart must be restorable`);
	assert.deepEqual(snapshot.appliedCouponCodes, [fixture.couponCode]);
	assert.equal(snapshot.lines.length, 1);
	assert.equal(snapshot.lines[0].productId, String(fixture.variableProduct));
	assert.equal(snapshot.lines[0].variationId, String(fixture.variation));
	const nativeAttribute = Object.entries(snapshot.lines[0].attributes ?? {}).find(
		([key]) => key.startsWith('attribute_')
	);
	assert.ok(nativeAttribute, `${kind}: selected native variation attribute must be retained`);
	assert.equal(nativeAttribute[1].toLowerCase(), 'large');
}

export async function assertCheckoutWordPress({
	siteUrl,
	wp,
	wpAsync,
	parseJsonOutput,
	getPendingCheckoutActions,
	getCheckoutActionHistory,
	getActivityRequests,
	setActivityStatus,
}) {
	const fixture = parseJsonOutput(
		wp(
			'eval',
			`
    update_option('woocommerce_custom_orders_table_enabled', 'yes');
    update_option('woocommerce_enable_guest_checkout', 'yes');
    update_option('woocommerce_enable_signup_and_login_from_checkout', 'yes');
    update_option('woocommerce_calc_taxes', 'no');
    $gateways = get_option('woocommerce_cod_settings', array()); $gateways['enabled'] = 'yes'; update_option('woocommerce_cod_settings', $gateways);
    update_option('woocommerce_currency', 'GBP');
    // Existing WooCommerce fixtures may use a Blocks checkout page. Force an
    // independent Classic shortcode page for the genuine update_order_review test.
    $previous_checkout_page = get_option('woocommerce_checkout_page_id');
    $checkout_page = wp_insert_post(array('post_title' => 'ARCH035 Classic Checkout',
      'post_name' => 'arch035-classic-checkout', 'post_status' => 'publish',
      'post_type' => 'page', 'post_content' => '[woocommerce_checkout]'));
    if (is_wp_error($checkout_page) || !$checkout_page) throw new Exception('Unable to create Classic checkout page');
    update_option('woocommerce_checkout_page_id', $checkout_page);
    $product = new WC_Product_Simple(); $product->set_name('ARCH035 integration product'); $product->set_status('publish');
    $product->set_regular_price('29.99'); $product->set_catalog_visibility('visible'); $product->save();
    $variable = new WC_Product_Variable(); $variable->set_name('ARCH053 restoration variation'); $variable->set_status('publish');
    $attribute = new WC_Product_Attribute(); $attribute->set_name('Size'); $attribute->set_options(array('Large'));
    $attribute->set_position(0); $attribute->set_visible(true); $attribute->set_variation(true);
    $variable->set_attributes(array($attribute)); $variable->save();
    $variation = new WC_Product_Variation(); $variation->set_parent_id($variable->get_id());
    $variation->set_attributes(array('size' => 'Large')); $variation->set_regular_price('19.99'); $variation->set_status('publish'); $variation->save();
    $variable->save();
    $coupon = new WC_Coupon(); $coupon->set_code('arch053save10'); $coupon->set_discount_type('percent'); $coupon->set_amount(10);
    $coupon->set_individual_use(true); $coupon->save();
    $customer_id = wp_create_user('arch035-checkout-customer-' . wp_generate_password(8, false), wp_generate_password(20), 'arch035-' . wp_generate_password(8, false) . '@example.test');
    if (is_wp_error($customer_id)) throw new Exception($customer_id->get_error_message());
    wp_update_user(array('ID' => $customer_id, 'role' => 'customer'));
    echo wp_json_encode(array('product' => $product->get_id(), 'variableProduct' => $variable->get_id(),
      'variation' => $variation->get_id(), 'coupon' => $coupon->get_id(), 'couponCode' => $coupon->get_code(), 'customer' => $customer_id,
      'classicCheckoutPage' => $checkout_page, 'previousCheckoutPage' => $previous_checkout_page,
      'hpos' => \\Automattic\\WooCommerce\\Utilities\\OrderUtil::custom_orders_table_usage_is_enabled()));
  `
		)
	);
	assert.equal(
		fixture.hpos,
		true,
		'HPOS must really be enabled, not just option-set'
	);
	const customerCookie = parseJsonOutput(
		wp(
			'eval',
			`
    $id = ${fixture.customer}; $expiry = time() + HOUR_IN_SECONDS;
    $token = WP_Session_Tokens::get_instance($id)->create($expiry);
    echo wp_json_encode(LOGGED_IN_COOKIE . '=' . wp_generate_auth_cookie($id, $expiry, 'logged_in', $token));
  `
		)
	);

	try {
		await assertNeverActiveEmpty({
			siteUrl,
			checkoutPage: fixture.classicCheckoutPage,
			createSession: session,
			getActions: getCheckoutActionHistory,
		});
		for (const [kind, cookie] of [
			['guest', ''],
			['customer', customerCookie],
		]) {
			// Classic: use a separate browser session, the real checkout page and
			// WooCommerce's update_order_review AJAX endpoint (no direct hook calls).
			const classic = session(siteUrl, cookie);
			let classicResponse = await classic.request(
				`/?add-to-cart=${fixture.product}`
			);
			assert.ok(
				[200, 302].includes(classicResponse.status),
				`${kind} classic add to cart`
			);
			classicResponse = await classic.request(
				`/?page_id=${fixture.classicCheckoutPage}`
			);
			assert.equal(
				classicResponse.status,
				200,
				`${kind} classic checkout page`
			);
			const classicBefore = checkoutEvents(getCheckoutActionHistory());
			const form = new URLSearchParams({
				post_data: new URLSearchParams({
					billing_first_name: 'Classic',
					billing_last_name: kind,
					billing_email: `classic-${kind}@example.test`,
					billing_phone: '+447700900001',
				}).toString(),
			});
			const html = await classicResponse.text();
			assert.match(
				html,
				/class=["'][^"']*woocommerce-checkout/,
				`${kind}: final checkout page must render the Classic form`
			);
			const reviewNonce = classicReviewNonce(html);
			assert.ok(
				reviewNonce,
				`${kind}: shortcode Classic checkout page must expose update_order_review_nonce (rendered form: ${/class=[\"'][^\"']*woocommerce-checkout/.test(html)})`
			);
			form.set('security', reviewNonce);
			classicResponse = await classic.request(
				'/?wc-ajax=update_order_review',
				{
					method: 'POST',
					headers: {
						'content-type': 'application/x-www-form-urlencoded',
					},
					body: form.toString(),
				}
			);
			await assertHttpOk(
				classicResponse,
				`${kind} classic checkout AJAX`
			);
			const classicAfter = checkoutEvents(getCheckoutActionHistory());
			const classicAdded = newForKey(classicBefore, classicAfter);
			assert.ok(
				classicAdded.length > 0,
				`${kind}: Classic AJAX must create a new action ID`
			);
			const classicEvent = newestAction(classicAdded).args.event;
			assertEvent(classicEvent);
			await assertClassicClearRefill({
				kind,
				browser: classic,
				productId: fixture.product,
				reviewNonce,
				reviewBody: form.get('post_data'),
				initialEvent: classicEvent,
				getActions: getCheckoutActionHistory,
			});
			process.stdout.write(
				`ARCH-035 Classic ${kind}: checkout AJAX capture PASS\n`
			);

			// Blocks: genuine Store API cart and checkout PATCH HTTP requests.
			const blocks = session(siteUrl, cookie);
			let r = await blocks.request('/wp-json/wc/store/v1/cart');
			assert.equal(r.status, 200, `${kind} cart GET`);
			r = await blocks.request('/wp-json/wc/store/v1/cart/add-item', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: fixture.product, quantity: 1 }),
			});
			assert.equal(
				r.status,
				201,
				`${kind} cart add-item: ${await r.clone().text()}`
			);
			r = await blocks.request('/wp-json/wc/store/v1/checkout');
			assert.equal(r.status, 200, `${kind} Store API checkout GET`);
			const body = {
				billing_address: {
					first_name: 'Test',
					last_name: kind,
					email: `${kind}@example.test`,
					phone: '+447700900001',
					country: 'GB',
					address_1: '10 Test Street',
					city: 'London',
					postcode: 'SE1 1AA',
				},
			};
			// A real Blocks checkout saves customer address separately from PATCH.
			// With an existing key (notably a logged-in shopper who just used
			// Classic checkout), cart/update-customer can publish that changed
			// snapshot first. PATCH must not duplicate an identical observation.
			const previous = checkoutEvents(getCheckoutActionHistory());
			await persistBlocksBilling(blocks, body.billing_address, kind);
			const afterCustomer = checkoutEvents(getCheckoutActionHistory());
			r = await blocks.request('/wp-json/wc/store/v1/checkout', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			assert.equal(
				r.status,
				200,
				`${kind} Store API PATCH: ${await r.clone().text()}`
			);
			const after = checkoutEvents(getCheckoutActionHistory());
			const customerAdded = newForKey(previous, afterCustomer);
			const patchAdded = newForKey(afterCustomer, after);
			const initialAdded = newForKey(previous, after);
			assert.ok(
				initialAdded.length > 0,
				`${kind}: customer update or checkout PATCH must enqueue an event ` +
					`(customer actions: ${customerAdded.length}, PATCH actions: ${patchAdded.length})`
			);
			// Both routes may emit if PATCH observes a genuinely different cart.
			// Reject only duplicate snapshots for the same checkout identity.
			for (const customerAction of customerAdded) {
				for (const patchAction of patchAdded) {
					if (
						customerAction.args.event.checkoutKey ===
						patchAction.args.event.checkoutKey
					) {
						assert.notDeepEqual(
							patchAction.args.event.checkout,
							customerAction.args.event.checkout,
							`${kind}: checkout PATCH must not duplicate a customer-update snapshot`
						);
					}
				}
			}
			const first = newestAction(initialAdded).args.event;
			assertEvent(first);
			assert.ok(
				initialAdded.every(
					(row) => row.args.event.checkoutKey === first.checkoutKey
				),
				`${kind}: Store API customer update and PATCH must use one checkout key`
			);
			assert.equal(
				first.checkout?.contact?.firstName,
				body.billing_address.first_name,
				`${kind}: first queued Store API snapshot must contain updated billing name`
			);
			// An identical PATCH must not publish another event after the first update.
			r = await blocks.request('/wp-json/wc/store/v1/checkout', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			assert.equal(r.status, 200);
			const unchangedRows = checkoutEvents(getCheckoutActionHistory());
			assert.equal(
				newForKey(after, unchangedRows).length,
				0,
				`${kind}: identical PATCH must not enqueue another action`
			);
			body.billing_address.first_name = 'Updated';
			await persistBlocksBilling(blocks, body.billing_address, kind);
			r = await blocks.request('/wp-json/wc/store/v1/checkout', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			assert.equal(r.status, 200);
			const patchResult = await r.json();
			const responseMatches =
				patchResult?.billing_address?.first_name ===
				body.billing_address.first_name;
			const revisedRows = checkoutEvents(getCheckoutActionHistory());
			const revisedAdded = newForKey(unchangedRows, revisedRows);
			const diagnostic = changedCheckoutDiagnostic(
				unchangedRows,
				revisedRows,
				body.billing_address.first_name,
				responseMatches
			);
			assert.ok(
				responseMatches,
				`${kind}: checkout response did not reflect the saved billing change: ${diagnostic}`
			);
			assert.ok(
				revisedAdded.length > 0,
				`${kind}: changed customer update or PATCH must enqueue a new action: ${diagnostic}`
			);
			const revised = newestAction(revisedAdded).args.event;
			assert.equal(
				revised.checkout?.contact?.firstName,
				body.billing_address.first_name,
				`${kind}: queued snapshot must contain updated billing name: ${diagnostic}`
			);
			assert.equal(revised.checkoutKey, first.checkoutKey);
			assert.notEqual(revised.eventId, first.eventId);
			// An HTTP API outage must not be on the customer's PATCH request path.
			setActivityStatus(503);
			const sentBefore = getActivityRequests().length;
			body.billing_address.last_name = `${kind}-outage`;
			await persistBlocksBilling(blocks, body.billing_address, kind);
			r = await blocks.request('/wp-json/wc/store/v1/checkout', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			await assertHttpOk(
				r,
				`${kind}: checkout PATCH during Moda API outage`
			);
			const outageRows = checkoutEvents(getCheckoutActionHistory());
			const outageAdded = newForKey(revisedRows, outageRows);
			const capturedEventIds = new Set(
				outageAdded.map((row) => row.args.event.eventId)
			);
			const synchronousCaptures = getActivityRequests()
				.slice(sentBefore)
				.filter((request) => capturedEventIds.has(request.eventId));
			assert.deepEqual(
				synchronousCaptures,
				[],
				'capture must not synchronously call the Moda API for checkout events'
			);
			assert.ok(
				outageAdded.length > 0,
				`${kind}: outage customer update or PATCH must create a new action`
			);
			const outageAction = newestAction(outageAdded);
			const outageEvent = outageAction.args.event;
			assertEvent(outageEvent);
			assert.equal(outageAction.args.attempt, 1);
			assert.notEqual(
				outageEvent.eventId,
				revised.eventId,
				'changed checkout creates an outage event'
			);
			assert.equal(outageEvent.checkoutKey, first.checkoutKey);
			// Run this particular persisted action through the real Action Scheduler
			// runner, not an arbitrary batch of other pending checkout actions.
			await runScheduledCheckoutAction(wpAsync, outageAction);
			assertActivityRequestForEvent(
				getActivityRequests().slice(sentBefore),
				outageEvent.eventId,
				503,
				`${kind}: initial checkout activity during outage`
			);
			const pending = checkoutEvents(getPendingCheckoutActions());
			assert.ok(
				!pending.some(
					(row) => String(row.id) === String(outageAction.id)
				),
				`${kind}: Action Scheduler must complete the original delivery action`
			);
			// Inspect only actions persisted *after* the selected original action ran.
			const retries = newCheckoutActions(outageRows, pending).filter(
				(row) =>
					row.args?.attempt === 2 &&
					row.args?.event?.eventId === outageEvent.eventId
			);
			assert.equal(
				retries.length,
				1,
				`${kind}: 503 must persist exactly one attempt 2 for the original checkout event`
			);
			const retry = retries[0];
			assert.deepEqual(retry.args.event, outageEvent);
			assert.equal(
				retry.args.installationId,
				outageAction.args.installationId
			);
			assert.equal(retry.args.shopId, outageAction.args.shopId);
			setActivityStatus(202);
			// WordPress clock remains unchanged: run the delayed retry callback with
			// its persisted payload rather than changing production backoff delays.
			const retryRequestsBefore = getActivityRequests().length;
			await deliverCapturedAction(wpAsync, retry);
			assertActivityRequestForEvent(
				getActivityRequests().slice(retryRequestsBefore),
				outageEvent.eventId,
				202,
				`${kind}: retry of original checkout event`
			);
			await assertStoreApiClearRefill({
				kind,
				browser: blocks,
				productId: fixture.product,
				checkoutBody: body,
				initialEvent: first,
				getActions: getCheckoutActionHistory,
			});
			// Capture order events before placement, so HPOS order creation can be
			// verified separately from earlier checkout events.
			const beforeOrder = getPendingCheckoutActions();
			// Place an actual order using Woo Store API; verify HPOS order-object metadata.
			r = await blocks.request('/wp-json/wc/store/v1/checkout', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					...body,
					payment_method: 'cod',
					customer_note: 'ARCH035 live checkout',
				}),
			});
			assert.equal(
				r.status,
				200,
				`${kind} Store API order placement: ${await r.clone().text()}`
			);
			const placed = await r.json();
			assert.ok(Number(placed.order_id) > 0, `${kind}: real order id`);
			const persisted = parseJsonOutput(
				wp(
					'eval',
					`
        $order = wc_get_order(${Number(placed.order_id)});
        echo wp_json_encode(array('key' => $order->get_meta('_moda_checkout_key', true),
          'dataStore' => $order->get_data_store()->get_current_class_name()));
      `
				)
			);
			assert.equal(
				persisted.key,
				first.checkoutKey,
				'HPOS order must retain the captured checkout key'
			);
			assert.ok(
				/OrdersTableDataStore/.test(persisted.dataStore),
				`HPOS must use the order-table data store (actual: ${persisted.dataStore})`
			);
			await assertOrderWordPress({
				kind,
				orderId: placed.order_id,
				checkoutKey: first.checkoutKey,
				beforeOrder,
				checkoutAction: newestAction(revisedAdded),
				getActions: getPendingCheckoutActions,
				newActions: newCheckoutActions,
				deliverAction: (action) =>
					deliverCapturedAction(wpAsync, action),
				wpAsync,
				getActivityRequests,
				setActivityStatus,
			});
			wp(
				'eval',
				`wc_get_order(${Number(placed.order_id)})->delete(true);`
			);
			process.stdout.write(
				`ARCH-035 Blocks ${kind}: capture, dedup, change, 503, retry and HPOS PASS\n`
			);
		}

		// Real Classic and Blocks carts verify the exact nested Shared restoration
		// projection with one original coupon and one selected variation.
		const classicRestore = session(siteUrl);
		await addVariableCartAndCoupon(classicRestore, fixture, 'Classic');
		let restoreResponse = await classicRestore.request(`/?page_id=${fixture.classicCheckoutPage}`);
		await assertHttpOk(restoreResponse, 'restoration Classic checkout page');
		const restoreHtml = await restoreResponse.text();
		const restoreNonce = classicReviewNonce(restoreHtml);
		assert.ok(restoreNonce, 'restoration Classic page must expose the checkout review nonce');
		const restoreForm = new URLSearchParams({
			post_data: new URLSearchParams({ billing_email: 'restore-classic@example.test' }).toString(),
			security: restoreNonce,
		});
		const classicBefore = checkoutEvents(getCheckoutActionHistory());
		restoreResponse = await classicRestore.request('/?wc-ajax=update_order_review', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: restoreForm.toString(),
		});
		await assertHttpOk(restoreResponse, 'restoration Classic checkout AJAX');
		const classicAfter = checkoutEvents(getCheckoutActionHistory());
		const classicAdded = newForKey(classicBefore, classicAfter);
		assert.ok(classicAdded.length > 0, 'Classic variation/coupon checkout must enqueue an action');
		assertSupportedVariationAndCoupon(newestAction(classicAdded).args.event, fixture, 'Classic');

		const blocksRestore = session(siteUrl);
		await addVariableCartAndCoupon(blocksRestore, fixture, 'Blocks');
		restoreResponse = await blocksRestore.request('/wp-json/wc/store/v1/checkout');
		assert.equal(restoreResponse.status, 200, 'restoration Blocks checkout GET');
		const blocksBody = {
			billing_address: {
				first_name: 'Restore', last_name: 'Blocks', email: 'restore-blocks@example.test',
				phone: '+447400123456', country: 'GB', address_1: '10 Test Street', city: 'London', postcode: 'SE1 1AA',
			},
		};
		const blocksBefore = checkoutEvents(getCheckoutActionHistory());
		await persistBlocksBilling(blocksRestore, blocksBody.billing_address, 'restoration Blocks');
		restoreResponse = await blocksRestore.request('/wp-json/wc/store/v1/checkout', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(blocksBody),
		});
		assert.equal(restoreResponse.status, 200, 'restoration Blocks checkout PATCH');
		const blocksAdded = newForKey(blocksBefore, checkoutEvents(getCheckoutActionHistory()));
		assert.ok(blocksAdded.length > 0, 'Blocks variation/coupon checkout must enqueue an action');
		assertSupportedVariationAndCoupon(newestAction(blocksAdded).args.event, fixture, 'Blocks');
	} finally {
		setActivityStatus(202);
		wp(
			'eval',
			`update_option('woocommerce_checkout_page_id', ${JSON.stringify(fixture.previousCheckoutPage)}); wp_delete_post(${fixture.classicCheckoutPage}, true); wp_delete_user(${fixture.customer}); wp_delete_post(${fixture.product}, true); wp_delete_post(${fixture.variableProduct}, true); wp_delete_post(${fixture.variation}, true); wp_delete_post(${fixture.coupon}, true);`
		);
	}
}
