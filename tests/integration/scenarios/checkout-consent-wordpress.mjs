import assert from 'node:assert/strict';
import { persistBlocksBilling, session } from './checkout-wordpress.mjs';
import { assertNoConsentCheckoutActivity } from '../consent-checkout-isolation.mjs';

const extensionRoute = '/wp-json/wc/store/v1/cart/extensions';
const extensionName = 'moda-interact-consent';

export function consentExtensionResult(body, requestId) {
	assert.ok(body && typeof body === 'object');
	const result = body.extensions?.[extensionName];
	assert.ok(
		result,
		'Real Woo CartSchema response must include the Moda extension'
	);
	assert.equal(result.requestId, requestId);
	assert.deepEqual(Object.keys(result).sort(), [
		'confirmed',
		'reason',
		'requestId',
		'status',
	]);
	assert.equal(typeof result.confirmed, 'boolean');
	assert.equal(typeof result.reason, 'string');
	assert.equal(typeof result.status, 'string');
	assert.doesNotMatch(
		JSON.stringify(result),
		/grantEventId|canonicalPhone|credential/
	);
	return result;
}

export async function storeConsentAction(
	client,
	action,
	requestId,
	overrides = {}
) {
	const { phone = '+447400123456', country = 'GB', ...data } = overrides;
	const response = await client.request(extensionRoute, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			namespace: extensionName,
			data: {
				action,
				requestId,
				expectedPhone: phone,
				expectedCountry: country,
				...data,
			},
		}),
	});
	assert.equal(
		response.status,
		200,
		`Woo cart/extensions ${action}: HTTP ${response.status} ${await response.clone().text()}`
	);
	return consentExtensionResult(await response.json(), requestId);
}

function checkPageBody(html, type) {
	assert.doesNotMatch(
		html,
		/data-moda-woo-runtime-mount/,
		'Removed React placeholder must never render'
	);
	assert.doesNotMatch(
		html,
		/grantEventId|moda_woo_checkout_grant_proof_v1/,
		'Protected grant evidence must not enter rendered checkout HTML'
	);
	if (type === 'classic') {
		assert.match(
			html,
			/name=["']moda_interact_whatsapp_recovery_opt_in["']/
		);
		assert.match(html, /id=["']moda-woo-consent-withdraw["']/);
		assert.match(html, /checkout-consent-classic\.js/);
	} else {
		assert.match(html, /checkout-consent-blocks-status\.js/);
		assert.match(
			html,
			/data-block-name=["']moda-interact\/checkout-consent["']/,
			'Actual Checkout Fields child must be emitted by WordPress'
		);
		assert.equal(
			(
				html.match(
					/data-block-name=["']moda-interact\/checkout-consent["']/g
				) ?? []
			).length,
			1,
			'Single registered Woo Blocks renderer: exactly one parsed child'
		);
	}
}

function classicNonce(html, name) {
	const escaped = html
		.replace(/&quot;|&#34;/g, '"')
		.replace(/&#039;|&#39;/g, "'");
	const regex = new RegExp(`["']${name}["']\\s*:\\s*["']([A-Za-z0-9]+)["']`);
	const value = escaped.match(regex)?.[1];
	assert.ok(value, `${name} must be available in the real rendered checkout`);
	return value;
}

function classicForm(phone = '+447400123456', withGrant = false) {
	return new URLSearchParams({
		billing_first_name: 'Consent',
		billing_last_name: 'Fixture',
		billing_email: 'consent-fixture@example.test',
		billing_phone: phone,
		billing_country: 'GB',
		...(withGrant
			? {
					moda_interact_whatsapp_recovery_opt_in: '1',
					moda_interact_whatsapp_recovery_checked_action: '1',
				}
			: {}),
	});
}

async function assertClassic({
	siteUrl,
	product,
	page,
	consent,
	getCheckoutActionHistory,
}) {
	const classic = session(siteUrl);
	let response = await classic.request(`/?add-to-cart=${product}`);
	assert.ok([200, 302].includes(response.status));
	response = await classic.request(`/?page_id=${page}`);
	assert.equal(response.status, 200);
	const html = await response.text();
	checkPageBody(html, 'classic');
	const reviewNonce = classicNonce(html, 'update_order_review_nonce');
	const config = html.match(
		/window\.modaWooCheckoutConsentConfig\s*=\s*(\{[^;]+\});/
	)?.[1];
	assert.ok(
		config,
		'Classic consent JS configuration must be server-injected'
	);
	const consentNonce = JSON.parse(config).nonce;
	assert.ok(consentNonce, 'WordPress checkout nonce required');
	const before = consent.getRequests().length;

	async function review(withGrant = false) {
		return classic.request('/?wc-ajax=update_order_review', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				security: reviewNonce,
				post_data: classicForm('+447400123456', withGrant).toString(),
			}).toString(),
		});
	}
	response = await review(false);
	assert.equal(
		response.status,
		200,
		'Classic refresh must not require order submission'
	);
	assert.equal(
		consent.getRequests().length,
		before,
		'Plain refresh never emits GRANT'
	);
	response = await review(true);
	assert.equal(
		response.status,
		200,
		'Native Classic checked-action AJAX must succeed'
	);
	assert.equal(
		consent.getRequests().length,
		before + 1,
		'One explicit Classic checked action publishes GRANT'
	);
	assert.equal(consent.getRequests().at(-1).event.decision, 'GRANT');
	response = await review(false);
	assert.equal(response.status, 200);
	assert.equal(
		consent.getRequests().length,
		before + 1,
		'Routine checkbox uncheck never publishes REVOKE'
	);

	async function rest(operation, payload) {
		const route = `/?wc-ajax=moda_interact_checkout_consent_${operation}`;
		const res = await classic.request(route, {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				security: consentNonce,
				mode: payload.mode,
				form: payload.form,
				...(operation === 'withdraw'
					? { confirmed: payload.confirmed ? '1' : '0' }
					: {}),
			}).toString(),
		});
		assert.equal(
			res.status,
			200,
			`Classic ${operation} must preserve the real Woo session (HTTP ${res.status})`
		);
		return res.json();
	}
	// Native Woo AJAX must still enforce the real checkout nonce, not just
	// the presence of a session cookie or a matching billing phone.
	const forbidden = await classic.request(
		'/?wc-ajax=moda_interact_checkout_consent_withdraw',
		{
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				security: 'invalid',
				mode: 'CLASSIC',
				confirmed: '1',
				form: classicForm().toString(),
			}).toString(),
		}
	);
	assert.equal(
		forbidden.status,
		403,
		'Forged checkout nonce must be rejected'
	);
	assert.equal(consent.getRequests().length, before + 1);
	const activityBefore = getCheckoutActionHistory();
	const form = classicForm().toString();
	let result = await rest('status', { mode: 'CLASSIC', form });
	assert.equal(
		result.confirmed,
		true,
		'Confirmed hosted proof replaces duplicate opt-in'
	);
	assert.equal(
		consent.getRequests().length,
		before + 1,
		'Status is read-only'
	);
	result = await rest('withdraw', {
		mode: 'CLASSIC',
		confirmed: false,
		form,
	});
	assert.equal(result.status, 'unverified');
	assert.equal(
		consent.getRequests().length,
		before + 1,
		'Missing confirmation never REVOKEs'
	);
	result = await rest('withdraw', { mode: 'CLASSIC', confirmed: true, form });
	assert.equal(result.status, 'withdrawn');
	assert.equal(consent.getRequests().length, before + 2);
	assert.equal(consent.getRequests().at(-1).event.decision, 'REVOKE');
	assert.notEqual(
		consent.getRequests().at(-1).event.eventId,
		consent.getRequests().at(-2).event.eventId
	);
	assertNoConsentCheckoutActivity({
		before: activityBefore,
		after: getCheckoutActionHistory(),
		productId: product,
		context: 'Classic STATUS and confirmed REVOKE',
	});
}

async function addBlocksProduct(client, product, tag) {
	let response = await client.request('/wp-json/wc/store/v1/cart');
	assert.equal(response.status, 200, `${tag}: real cart GET`);
	response = await client.request('/wp-json/wc/store/v1/cart/add-item', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ id: product, quantity: 1 }),
	});
	assert.equal(response.status, 201, `${tag}: add-item`);
	await persistBlocksBilling(
		client,
		{
			first_name: 'Consent',
			last_name: tag,
			email: `${tag}@example.test`,
			phone: '+447400123456',
			country: 'GB',
			address_1: '10 Test Street',
			city: 'London',
			postcode: 'SE1 1AA',
		},
		tag
	);
}

async function assertBlocks({
	siteUrl,
	product,
	page,
	consent,
	getCheckoutActionHistory,
}) {
	const checkout = session(siteUrl);
	await addBlocksProduct(checkout, product, 'blocks-consent');
	const htmlResponse = await checkout.request(`/?page_id=${page}`);
	assert.equal(htmlResponse.status, 200);
	checkPageBody(await htmlResponse.text(), 'blocks');
	const activityBefore = getCheckoutActionHistory();
	const start = consent.getRequests().length;
	const readStart = consent.getStatusRequests().length;
	let result = await storeConsentAction(checkout, 'status', 'blocks-initial');
	assert.deepEqual([result.status, result.confirmed], ['checked', false]);
	assert.equal(
		consent.getStatusRequests().length,
		readStart,
		'No proof -> no remote lookup'
	);
	assert.equal(
		consent.getRequests().length,
		start,
		'Status and hydration are read-only'
	);
	assertNoConsentCheckoutActivity({
		before: activityBefore,
		after: getCheckoutActionHistory(),
		productId: product,
		context: 'Blocks initial status',
	});

	result = await storeConsentAction(checkout, 'choice', 'blocks-unchecked', {
		checked: false,
	});
	assert.equal(result.status, 'unverified');
	assert.equal(
		consent.getRequests().length,
		start,
		'Unchecked checkbox cannot publish REVOKE'
	);
	result = await storeConsentAction(checkout, 'choice', 'blocks-bad-phone', {
		checked: true,
		phone: '+447400123457',
	});
	assert.equal(result.status, 'unverified');
	assert.equal(
		consent.getRequests().length,
		start,
		'Forged/stale phone cannot publish consent'
	);
	// The Shared 2.5.0 golden vectors reject Ofcom's drama number range.
	// Keep that a separate negative case, never the normal checkout fixture.
	result = await storeConsentAction(
		checkout,
		'choice',
		'blocks-reserved-phone',
		{ checked: true, phone: '+447700900001' }
	);
	assert.equal(result.status, 'unverified');
	assert.equal(
		consent.getRequests().length,
		start,
		'Rejected drama-range phone must not publish consent'
	);

	result = await storeConsentAction(checkout, 'choice', 'blocks-grant-1', {
		checked: true,
	});
	assert.equal(
		result.status,
		'recorded',
		`GRANT must be ACKed: ${result.reason}`
	);
	assert.equal(consent.getRequests().length, start + 1);
	const grant = consent.getRequests().at(-1).event;
	assertNoConsentCheckoutActivity({
		before: activityBefore,
		after: getCheckoutActionHistory(),
		productId: product,
		context: 'Blocks explicit GRANT',
	});
	assert.equal(grant.decision, 'GRANT');
	assert.equal(grant.canonicalPhone, '447400123456');
	result = await storeConsentAction(checkout, 'status', 'blocks-after-grant');
	assert.equal(
		result.confirmed,
		true,
		`Proof-backed GRANT status: ${result.reason}`
	);
	assert.equal(consent.getStatusRequests().length, readStart + 1);
	assert.equal(
		consent.getStatusRequests().at(-1).grantEventId,
		grant.eventId
	);
	assert.equal(consent.getRequests().length, start + 1);
	consent.setReadStatus(503);
	try {
		result = await storeConsentAction(
			checkout,
			'status',
			'blocks-status-unavailable'
		);
		assert.equal(
			result.confirmed,
			false,
			'Read outage is never a claimed GRANT'
		);
		assert.equal(result.reason, 'consent_status_remote_unavailable');
		assert.equal(consent.getRequests().length, start + 1);
	} finally {
		consent.setReadStatus(200);
	}
	result = await storeConsentAction(checkout, 'choice', 'blocks-grant-1', {
		checked: true,
	});
	assert.equal(
		result.status,
		'recorded',
		'Retry shares the same request ID and ACK'
	);
	assert.equal(
		consent.getRequests().length,
		start + 1,
		'No duplicate GRANT on replay'
	);
	result = await storeConsentAction(
		checkout,
		'withdraw',
		'blocks-withdraw-unconfirmed',
		{ confirmed: false }
	);
	assert.equal(result.status, 'unverified');
	assert.equal(consent.getRequests().length, start + 1);
	result = await storeConsentAction(
		checkout,
		'withdraw',
		'blocks-withdraw-1',
		{ confirmed: true }
	);
	assert.equal(
		result.status,
		'recorded',
		`Explicit REVOKE must be ACKed: ${result.reason}`
	);
	assert.equal(consent.getRequests().length, start + 2);
	const revoke = consent.getRequests().at(-1).event;
	assert.equal(revoke.decision, 'REVOKE');
	assert.notEqual(revoke.eventId, grant.eventId);
	result = await storeConsentAction(
		checkout,
		'status',
		'blocks-after-revoke'
	);
	assert.equal(result.confirmed, false);
	result = await storeConsentAction(checkout, 'choice', 'blocks-grant-1', {
		checked: true,
	});
	assert.equal(
		result.status,
		'unverified',
		'Stale replay after withdrawal cannot regrant'
	);
	assert.equal(consent.getRequests().length, start + 2);
	assertNoConsentCheckoutActivity({
		before: activityBefore,
		after: getCheckoutActionHistory(),
		productId: product,
		context: 'Blocks consent STATUS/GRANT/REVOKE',
	});

	// A second browser with the same telephone number has no server-held proof.
	const beforeOtherLookup = consent.getStatusRequests().length;
	const other = session(siteUrl);
	await addBlocksProduct(other, product, 'separate-guest');
	const otherActivityBefore = getCheckoutActionHistory();
	result = await storeConsentAction(other, 'status', 'other-guest-status');
	assert.equal(result.confirmed, false, 'Phone equality is not identity');
	assert.equal(
		consent.getStatusRequests().length,
		beforeOtherLookup,
		'New guest is not allowed to search hosted history by phone'
	);

	// Remote outage leaves consent unconfirmed, with checkout still available.
	consent.setWriteStatus(503);
	try {
		result = await storeConsentAction(
			other,
			'choice',
			'other-guest-outage',
			{ checked: true }
		);
		assert.equal(result.status, 'unverified');
		assert.equal(result.confirmed, false);
		assert.equal(consent.getRequests().at(-1).httpStatus, 503);
	} finally {
		consent.setWriteStatus(200);
	}
	result = await storeConsentAction(
		other,
		'status',
		'other-guest-after-outage'
	);
	assert.equal(
		result.confirmed,
		false,
		'Hosted failure cannot create a proof'
	);
	assertNoConsentCheckoutActivity({
		before: otherActivityBefore,
		after: getCheckoutActionHistory(),
		productId: product,
		context: 'Separate guest status and failed GRANT',
	});
}

async function assertAccount({
	siteUrl,
	product,
	cookie,
	consent,
	getCheckoutActionHistory,
}) {
	const first = session(siteUrl, cookie);
	await addBlocksProduct(first, product, 'account-first');
	const firstActivityBefore = getCheckoutActionHistory();
	const before = consent.getStatusRequests().length;
	let result = await storeConsentAction(
		first,
		'status',
		'account-before-grant'
	);
	assert.equal(
		result.confirmed,
		false,
		'Account alone is not proof of consent'
	);
	assert.equal(consent.getStatusRequests().length, before);
	result = await storeConsentAction(first, 'choice', 'account-grant', {
		checked: true,
	});
	assert.equal(
		result.status,
		'recorded',
		'Signed-in shopper explicitly grants'
	);
	const grant = consent.getRequests().at(-1).event;
	assert.equal(grant.decision, 'GRANT');
	assertNoConsentCheckoutActivity({
		before: firstActivityBefore,
		after: getCheckoutActionHistory(),
		productId: product,
		context: 'Account status and explicit GRANT',
	});
	// A new Woo session for the SAME WordPress account can rely on its own
	// protected account metadata, but not on a guest's phone-only status.
	const returning = session(siteUrl, cookie);
	await addBlocksProduct(returning, product, 'account-returning');
	const returningActivityBefore = getCheckoutActionHistory();
	result = await storeConsentAction(returning, 'status', 'account-returned');
	assert.equal(
		result.confirmed,
		true,
		'Same account may read its stored grant proof'
	);
	assert.equal(
		consent.getStatusRequests().at(-1).grantEventId,
		grant.eventId
	);
	result = await storeConsentAction(
		returning,
		'withdraw',
		'account-withdraw',
		{ confirmed: true }
	);
	assert.equal(result.status, 'recorded');
	assert.equal(consent.getRequests().at(-1).event.decision, 'REVOKE');
	assertNoConsentCheckoutActivity({
		before: returningActivityBefore,
		after: getCheckoutActionHistory(),
		productId: product,
		context: 'Returning account status and confirmed REVOKE',
	});
	const loggedOut = session(siteUrl);
	await addBlocksProduct(loggedOut, product, 'after-account-logout');
	const loggedOutActivityBefore = getCheckoutActionHistory();
	result = await storeConsentAction(
		loggedOut,
		'status',
		'anonymous-account-phone'
	);
	assert.equal(
		result.confirmed,
		false,
		'Guest cannot reuse another account proof'
	);
	assertNoConsentCheckoutActivity({
		before: loggedOutActivityBefore,
		after: getCheckoutActionHistory(),
		productId: product,
		context: 'Logged-out guest status',
	});
}

/**
 * Real WordPress/Woo HTTP checkout-to-Moda fixture, never a collection of
 * mocked PHP controller calls. Changes disposable checkout page options and
 * creates product/pages; the API-006 fixture remains a provisional wire test.
 */
export async function assertCheckoutConsentWordPress({
	siteUrl,
	wp,
	parseJsonOutput,
	fixture,
	getCheckoutActionHistory,
	withBrowser = false,
}) {
	const original = parseJsonOutput(
		wp('eval', 'echo wp_json_encode(wc_get_page_id("checkout"));')
	);
	const pages = parseJsonOutput(
		wp(
			'eval',
			`
		$product = new WC_Product_Simple();
		$product->set_name('ARCH046 consent integration product');
		$product->set_status('publish');
		$product->set_regular_price('19.99');
		$product->save();
		$classic = wp_insert_post(array('post_title' => 'ARCH046 classic consent',
			'post_status' => 'publish', 'post_type' => 'page', 'post_content' => '[woocommerce_checkout]'));
		$current = get_post(wc_get_page_id('checkout'));
		$blocks = $current && has_block('woocommerce/checkout', $current)
			? (int) $current->ID : 0;
		echo wp_json_encode(array('product' => $product->get_id(),
			'classic' => $classic, 'blocks' => $blocks));
	`
		)
	);
	assert.ok(pages.product > 0 && pages.classic > 0);
	assert.ok(
		pages.blocks > 0,
		'Consent test requires a real saved WooCommerce Blocks checkout page; do not invent a placeholder template'
	);
	fixture.consent.setFeatureEnabled(true);
	try {
		wp(
			'option',
			'update',
			'woocommerce_checkout_page_id',
			String(pages.classic)
		);
		await assertClassic({
			siteUrl,
			product: pages.product,
			page: pages.classic,
			consent: fixture.consent,
			getCheckoutActionHistory,
		});
		wp(
			'option',
			'update',
			'woocommerce_checkout_page_id',
			String(pages.blocks)
		);
		if (withBrowser) {
			const { assertCheckoutConsentBrowser } =
				await import('./checkout-consent-browser.mjs');
			await assertCheckoutConsentBrowser({
				siteUrl,
				page: pages.blocks,
				product: pages.product,
				consent: fixture.consent,
			});
		}
		await assertBlocks({
			siteUrl,
			product: pages.product,
			page: pages.blocks,
			consent: fixture.consent,
			getCheckoutActionHistory,
		});
		const customer = parseJsonOutput(
			wp(
				'eval',
				`
			$login = 'arch046-consent-' . wp_generate_password(10, false);
			$id = wp_create_user($login, wp_generate_password(20), $login . '@example.test');
			if (is_wp_error($id)) throw new Exception($id->get_error_message());
			wp_update_user(array('ID' => $id, 'role' => 'customer'));
			$expiry = time() + HOUR_IN_SECONDS;
			$token = WP_Session_Tokens::get_instance($id)->create($expiry);
			echo wp_json_encode(LOGGED_IN_COOKIE . '=' . wp_generate_auth_cookie($id, $expiry, 'logged_in', $token));
		`
			)
		);
		await assertAccount({
			siteUrl,
			product: pages.product,
			cookie: customer,
			consent: fixture.consent,
			getCheckoutActionHistory,
		});
		process.stdout.write(
			'ARCH-046 consent real WordPress HTTP integration PASS (hosted read simulated)\n'
		);
	} finally {
		fixture.consent.setFeatureEnabled(false);
		fixture.consent.setReadStatus(200);
		fixture.consent.setWriteStatus(200);
		wp(
			'option',
			'update',
			'woocommerce_checkout_page_id',
			String(original)
		);
	}
}
