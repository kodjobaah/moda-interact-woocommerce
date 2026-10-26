import assert from 'node:assert/strict';

/**
 * Runs the category-only REST flow against disposable WordPress and HTTPS fixture.
 *
 * @param {Object} fixture - Environment and remote fixture accessors.
 */
export async function assertStoreCategoryWordPress(fixture) {
	const { siteUrl, auth, wp, parseJsonOutput, getCategoryState } = fixture;
	const root = `${siteUrl}/wp-json/moda-interact/v1/merchant/`;
	const headers = {
		Cookie: `${auth.cookieName}=${auth.cookie}`,
		'X-WP-Nonce': auth.nonce,
	};
	const read = (extra = {}) =>
		fetch(`${root}store-categories`, { headers: { ...headers, ...extra } });
	const post = (body, extra = {}) =>
		fetch(`${root}store-category`, {
			method: 'POST',
			headers: {
				...headers,
				'content-type': 'application/json',
				...extra,
			},
			body: JSON.stringify(body),
		});

	const unauthenticated = await fetch(`${root}store-categories`);
	assert.ok([401, 403].includes(unauthenticated.status));
	const invalidNonce = await read({ 'X-WP-Nonce': 'invalid' });
	assert.ok([401, 403].includes(invalidNonce.status));
	const categoryBody = {
		schemaVersion: 1,
		categoryId: 'fashion',
		selectedMappingIds: ['clothing'],
		expectedPendingSelectionGeneration: 0,
	};
	const subscriber = parseJsonOutput(
		wp(
			'eval',
			'$name = "moda_woo_category_reader"; $user = get_user_by("login", $name); if (!$user) { $id = wp_create_user($name, wp_generate_password(32), "moda_woo_category_reader@example.invalid"); $user = get_user_by("id", $id); } $user->set_role("subscriber"); $expiration = time() + DAY_IN_SECONDS; $token = WP_Session_Tokens::get_instance($user->ID)->create($expiration); $cookie = wp_generate_auth_cookie($user->ID, $expiration, "logged_in", $token); $_COOKIE[LOGGED_IN_COOKIE] = $cookie; wp_set_current_user($user->ID); echo wp_json_encode(array("cookieName" => LOGGED_IN_COOKIE, "cookie" => $cookie, "nonce" => wp_create_nonce("wp_rest")));'
		)
	);
	const denied = await post(categoryBody, {
		Cookie: `${subscriber.cookieName}=${subscriber.cookie}`,
		'X-WP-Nonce': subscriber.nonce,
	});
	assert.equal(denied.status, 403);
	assert.equal(getCategoryState().selections, 0);

	const catalogue = await read();
	assert.equal(catalogue.status, 200);
	const readData = await catalogue.json();
	assert.equal(readData.schemaVersion, 1);
	assert.equal(readData.storeProfile.activeCategory, null);
	assert.equal(readData.categories[0].localizedDisplayName, 'Fashion');
	assert.equal(
		getCategoryState().selections,
		0,
		'GET must never select or publish'
	);

	const injection = await post({ ...categoryBody, shopId: 'other_shop' });
	assert.equal(injection.status, 400);
	assert.equal(getCategoryState().selections, 0);
	const stale = await post({
		...categoryBody,
		expectedPendingSelectionGeneration: 99,
	});
	assert.equal(stale.status, 409);
	assert.equal(getCategoryState().generation, 0);

	const saved = await post(categoryBody);
	assert.equal(saved.status, 200);
	const savedData = await saved.json();
	assert.equal(savedData.activeCategoryId, 'fashion');
	assert.equal(savedData.pendingSelectionGeneration, 1);
	assert.equal(getCategoryState().selections, 1);
	const after = await (await read()).json();
	assert.equal(after.storeProfile.activeCategory.id, 'fashion');
	assert.deepEqual(after.storeProfile.activeMappingIds, ['clothing']);

	const bootstrap = await fetch(`${root}bootstrap`, { headers });
	assert.equal(bootstrap.status, 200);
	assert.equal(
		(await bootstrap.json()).storeProfile.activeCategory.id,
		'fashion'
	);
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
