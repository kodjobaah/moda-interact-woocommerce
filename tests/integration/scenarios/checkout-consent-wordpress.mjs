import assert from 'node:assert/strict';
import { persistBlocksBilling, session } from './checkout-wordpress.mjs';
import { assertNoConsentCheckoutActivity } from '../consent-checkout-isolation.mjs';

const extensionRoute = '/wp-json/wc/store/v1/cart/extensions';
const extensionName = 'moda-interact-consent';
const classicCheckoutForm = /<form\b[^>]*class=["'][^"']*\bwoocommerce-checkout\b/;

/** Read only the fixed-shape, non-sensitive signals from the disposable WP probe. */
export function classicCheckoutProbe(html) {
	const match = html.match(
		/<!-- MODA_ARCH046_CONSENT_PROBE (\{[^<>\r\n]{1,512}\}) -->/
	);
	let data;
	try {
		data = match ? JSON.parse(match[1]) : null;
	} catch {
		data = null;
	}
	return {
		probePresent: !!data && typeof data === 'object',
		phpCartLoaded: data?.phpCartLoaded === true,
		phpCartCount:
			Number.isSafeInteger(data?.phpCartCount) &&
			data.phpCartCount >= 0
				? Math.min(data.phpCartCount, 10000)
				: null,
		hasClassicShortcode: data?.hasClassicShortcode === true,
		comingSoonEnabled: data?.comingSoonEnabled === true,
		shortcodeRegistered: data?.shortcodeRegistered === true,
		postContentFilterReached: data?.postContentFilterReached === true,
		shortcodeCallbackReached: data?.shortcodeCallbackReached === true,
		shortcodeOutputProduced: data?.shortcodeOutputProduced === true,
		shortcodeEntered: data?.shortcodeEntered === true,
		beforeFormHookEntered: data?.beforeFormHookEntered === true,
	};
}

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
		`Woo cart/extensions ${action}: unexpected HTTP ${response.status}`
	);
	return consentExtensionResult(await response.json(), requestId);
}

/** Emit bounded, non-sensitive evidence rather than dumping checkout HTML (and its nonces). */
export function checkPageBody(
	html,
	type,
	featureReads = { total: 0, enabled: 0 }
) {
	const signals = {
		type,
		isCheckoutPage: /woocommerce-checkout/.test(html),
		hasCheckoutFields: /wp-block-woocommerce-checkout-fields-block/.test(
			html
		),
		hasClassicCheckoutForm: classicCheckoutForm.test(html),
		hasCartEmptyNotice: [
			/your cart is (?:currently )?empty/i,
			/checkout is not available (?:whilst|while) your cart is empty/i,
			/no products in (?:your|the) cart/i,
		].some((pattern) => pattern.test(html)),
		hasConsentConfig: /window\.modaWooCheckoutConsentConfig\s*=/.test(html),
		hasClassicConsentScript: /checkout-consent-classic\.js/.test(html),
		hasBlocksConsentScript: /checkout-consent-blocks-status\.js/.test(html),
		...(type === 'classic' ? classicCheckoutProbe(html) : {}),
		featureReads: featureReads.total,
		enabledFeatureReads: featureReads.enabled,
	};
	const context = JSON.stringify(signals);
	function requirePresence(pattern, description) {
		assert.ok(pattern.test(html), `${description}; ${context}`);
	}
	function requireAbsence(pattern, description) {
		assert.ok(!pattern.test(html), `${description}; ${context}`);
	}
	requireAbsence(
		/data-moda-woo-runtime-mount/,
		'Removed React placeholder must never render'
	);
	requireAbsence(
		/grantEventId|moda_woo_checkout_grant_proof_v1/,
		'Protected grant evidence must not enter checkout HTML'
	);
	if (type === 'classic') {
		requirePresence(
			classicCheckoutForm,
			'Classic shortcode must render the checkout form (verify cart and guest-checkout settings)'
		);
		requirePresence(
			/name=["']moda_interact_whatsapp_recovery_opt_in["']/,
			'Actual Classic consent checkbox must be emitted'
		);
		requireAbsence(
			/id=["']moda-woo-consent-withdraw["']/,
			'Classic must not render a separate withdrawal button'
		);
		requirePresence(
			/checkout-consent-classic\.js/,
			'Classic consent JavaScript must be enqueued'
		);
	} else {
		requirePresence(
			/checkout-consent-blocks-status\.js/,
			'Woo consent Blocks JavaScript must be enqueued'
		);
		assert.ok(
			/woocommerce-checkout/.test(html),
			`Woo Blocks checkout page must exist; ${context}`
		);
		requireAbsence(
			/data-block-name=["']moda-interact\/checkout-consent["']/,
			'Obsolete custom child block must not be emitted'
		);

	}
}

/** Verify the real session cart, not merely an HTTP success response. */
export function assertCartContainsProduct(cart, product) {
	assert.ok(
		Array.isArray(cart?.items) &&
			cart.items.some(
				(item) => item.id === product && item.quantity > 0
			),
		'Live checkout cart must contain the exact fixture product before consent assertions'
	);
}

/**
 * Start Classic checkout through Woo's frontend handler, which establishes the
 * cookie-backed WC session seen by the PHP shortcode. A Store API add-item
 * success only proves its own REST cart, not continuity into Classic checkout.
 * Verify the resulting product through the Store API using the same cookies.
 */
export async function bootstrapClassicCart(client, product) {
	assert.ok(Number.isSafeInteger(product) && product > 0);
	const added = await client.request(`/?add-to-cart=${product}`);
	assert.equal(added.status, 200, 'Classic frontend add-to-cart must succeed');
	const cart = await client.request('/wp-json/wc/store/v1/cart');
	assert.equal(cart.status, 200, 'Classic cookie-backed cart verification GET');
	assertCartContainsProduct(await cart.json(), product);
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
	// Native frontend add-to-cart establishes the Classic checkout session.
	// Then verify the product via the Store API with the SAME cookie jar;
	// an HTTP 200 from add-to-cart alone never proves that a cart was created.
	await bootstrapClassicCart(classic, product);
	const readsBeforePage = consent.getFeatureReadDiagnostics();
	let response = await classic.request(`/?page_id=${page}`, {
		headers: { 'x-moda-arch046-test-probe': '1' },
	});
	assert.equal(response.status, 200);
	const html = await response.text();
	const readsAfterPage = consent.getFeatureReadDiagnostics();
	checkPageBody(html, 'classic', {
		total: readsAfterPage.total - readsBeforePage.total,
		enabled: readsAfterPage.enabled - readsBeforePage.enabled,
	});
	assert.equal(
		readsAfterPage.total,
		readsBeforePage.total,
		'Classic checkout rendering must not synchronously request hosted feature eligibility'
	);
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
	const readsBeforePage = consent.getFeatureReadDiagnostics();
	const htmlResponse = await checkout.request(`/?page_id=${page}`);
	assert.equal(htmlResponse.status, 200);
	const html = await htmlResponse.text();
	const readsAfterPage = consent.getFeatureReadDiagnostics();
	checkPageBody(html, 'blocks', {
		total: readsAfterPage.total - readsBeforePage.total,
		enabled: readsAfterPage.enabled - readsBeforePage.enabled,
	});
	assert.equal(
		readsAfterPage.total,
		readsBeforePage.total,
		'Blocks checkout rendering must not synchronously request hosted feature eligibility'
	);
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
		// Like the ARCH-035 real checkout suite, make the disposable test
		// site explicitly allow guest checkout. Capture the previous settings.
		$previous_guest_checkout = get_option('woocommerce_enable_guest_checkout', null);
		$previous_checkout_login = get_option('woocommerce_enable_signup_and_login_from_checkout', null);
		$previous_coming_soon = get_option('woocommerce_coming_soon', null);
		// Fresh WooCommerce installs can hide checkout behind Coming Soon.
		// A guest HTTP test must exercise the real checkout, not that template.
		update_option('woocommerce_coming_soon', 'no');
		update_option('woocommerce_enable_guest_checkout', 'yes');
		update_option('woocommerce_enable_signup_and_login_from_checkout', 'yes');
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
			'classic' => $classic, 'blocks' => $blocks,
			'previousGuestCheckout' => $previous_guest_checkout,
			'previousCheckoutLogin' => $previous_checkout_login,
			'previousComingSoon' => $previous_coming_soon));
	`
		)
	);
	assert.ok(pages.product > 0 && pages.classic > 0);
	process.stdout.write(
		`[ARCH046] Disposable storefront: Coming Soon was ${pages.previousComingSoon === 'yes' ? 'enabled' : 'not enabled'}; checkout tests require live visibility\n`
	);
	assert.ok(
		pages.blocks > 0,
		'Consent test requires a real saved WooCommerce Blocks checkout page; do not invent a placeholder template'
	);
	// An explicitly disabled recovery feature must not suppress v2 passive
	// consent evidence. The old Woo capture gate used this endpoint on GRANT.
	fixture.consent.setFeatureEnabled(false);
	let probeInstalled = false;
	try {
		// The mu-plugin reports only whether the PHP checkout had a cart and
		// reached Woo's shortcode hooks. Never replace a different MU plugin.
		wp(
			'eval',
			`$source = dirname(MODA_INTERACT_MAIN_PLUGIN_FILE) . '/tests/integration/checkout-consent-test-probe.php';
			$target = WPMU_PLUGIN_DIR . '/arch046-consent-test-probe.php';
			if (!is_file($source) || !wp_mkdir_p(WPMU_PLUGIN_DIR)) throw new Exception('ARCH046 diagnostic probe unavailable');
			if (is_file($target) && hash_file('sha256', $source) !== hash_file('sha256', $target)) throw new Exception('ARCH046 probe destination conflict');
			if (!copy($source, $target)) throw new Exception('ARCH046 diagnostic probe could not be installed');`
		);
		probeInstalled = true;
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
		if (withBrowser) {
			const { assertClassicConsentBrowser } =
				await import('./checkout-consent-browser.mjs');
			await assertClassicConsentBrowser({
				siteUrl,
				page: pages.classic,
				product: pages.product,
				consent: fixture.consent,
			});
		}
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
		assert.deepEqual(
			fixture.consent.getFeatureReadDiagnostics(),
			{ total: 0, enabled: 0 },
			'No Classic/Blocks render, GRANT, REVOKE, retry or status operation may fetch recovery feature preferences'
		);
		process.stdout.write(
			'ARCH-046 consent real WordPress HTTP integration PASS (hosted read simulated)\n'
		);
	} finally {
		// Remove the probe before restoring Woo settings, including on assertion
		// failure. This must never remain active on the test site after the run.
		if (probeInstalled) {
			wp(
				'eval',
				"@unlink(WPMU_PLUGIN_DIR . '/arch046-consent-test-probe.php');"
			);
		}
		fixture.consent.setFeatureEnabled(false);
		fixture.consent.setReadStatus(200);
		fixture.consent.setWriteStatus(200);
		wp(
			'option',
			'update',
			'woocommerce_checkout_page_id',
			String(original)
		);
		// Restore the store's original guest-checkout settings after the
		// disposable test, including an option that was previously absent.
		const originalSettings = Buffer.from(
			JSON.stringify({
				woocommerce_enable_guest_checkout: pages.previousGuestCheckout,
				woocommerce_enable_signup_and_login_from_checkout:
					pages.previousCheckoutLogin,
				woocommerce_coming_soon: pages.previousComingSoon,
			})
		).toString('base64');
		wp(
			'eval',
			`$settings = json_decode(base64_decode('${originalSettings}'), true);
			foreach ($settings as $name => $value) {
				if ($value === null) delete_option($name);
				else update_option($name, $value);
			}`
		);
	}
}
