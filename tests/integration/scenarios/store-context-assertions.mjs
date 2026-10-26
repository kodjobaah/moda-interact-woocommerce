import assert from 'node:assert/strict';

/**
 * Exercise WordPress REST permissions, server-derived context, retry, and readback.
 *
 * @param {Object} fixture - WordPress fixture dependencies.
 */
export async function assertStoreContextWordPress(fixture) {
	const { siteUrl, auth, wp, getFixtureState, parseJsonOutput } = fixture;
	const url = `${siteUrl}/wp-json/moda-interact/v1/merchant/store-context/sync`;
	const headers = {
		Cookie: `${auth.cookieName}=${auth.cookie}`,
		'X-WP-Nonce': auth.nonce,
	};
	const post = (options = {}) =>
		fetch(url, {
			method: 'POST',
			...options,
			headers: { ...headers, ...(options.headers ?? {}) },
		});

	wp(
		'eval',
		'update_option("WPLANG", "en_GB"); update_option("timezone_string", "Europe/London"); update_option("woocommerce_default_country", "GB");'
	);

	const denied = await fetch(url, { method: 'POST' });
	assert.ok([401, 403].includes(denied.status));
	const subscriber = parseJsonOutput(
		wp(
			'eval',
			'$name = "moda_woo_store_context_reader"; $user = get_user_by("login", $name); if (!$user) { $id = wp_create_user($name, wp_generate_password(32), "moda_woo_store_context_reader@example.invalid"); $user = get_user_by("id", $id); } $user->set_role("subscriber"); $expiration = time() + DAY_IN_SECONDS; $token = WP_Session_Tokens::get_instance($user->ID)->create($expiration); $cookie = wp_generate_auth_cookie($user->ID, $expiration, "logged_in", $token); $_COOKIE[LOGGED_IN_COOKIE] = $cookie; wp_set_current_user($user->ID); echo wp_json_encode(array("cookieName" => LOGGED_IN_COOKIE, "cookie" => $cookie, "nonce" => wp_create_nonce("wp_rest")));'
		)
	);
	const nonAdmin = await post({
		headers: {
			Cookie: `${subscriber.cookieName}=${subscriber.cookie}`,
			'X-WP-Nonce': subscriber.nonce,
		},
	});
	assert.equal(nonAdmin.status, 403);
	const invalidNonce = await post({ headers: { 'X-WP-Nonce': 'bad' } });
	assert.ok([401, 403].includes(invalidNonce.status));
	const injection = await post({
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ countryCode: 'US', shopId: 'other_shop' }),
	});
	assert.equal(injection.status, 400);
	assert.equal(getFixtureState().attempts, 0);

	const first = await post();
	assert.equal(
		first.status,
		503,
		'fixture first response simulates temporary API outage'
	);
	assert.deepEqual(await first.json(), { status: 'REMOTE_UNAVAILABLE' });
	const second = await post();
	assert.equal(second.status, 200);
	assert.deepEqual(await second.json(), { status: 'SYNCED' });
	const snapshot = getFixtureState().saved;
	assert.deepEqual(snapshot, {
		schemaVersion: 1,
		storeLocale: 'en_GB',
		languageTag: 'en-GB',
		timeZone: 'Europe/London',
		countryCode: 'GB',
	});
	assert.equal(getFixtureState().attempts, 2);

	const bootstrap = await fetch(
		`${siteUrl}/wp-json/moda-interact/v1/merchant/bootstrap`,
		{ headers }
	);
	assert.equal(bootstrap.status, 200);
	const data = await bootstrap.json();
	assert.deepEqual(data.internationalContext, {
		storeLocale: snapshot.storeLocale,
		languageTag: snapshot.languageTag,
		timeZone: snapshot.timeZone,
		countryCode: snapshot.countryCode,
	});
	assert.equal(data.storeProfile.activeCategory, null);
	assert.deepEqual(
		parseJsonOutput(
			wp(
				'eval',
				'echo wp_json_encode(array(get_option("moda_interact_woocommerce_connection")["installationId"], get_option("moda_interact_woocommerce_connection")["credentialVersion"]));'
			)
		),
		['install_wp_fixture', 2]
	);
}
