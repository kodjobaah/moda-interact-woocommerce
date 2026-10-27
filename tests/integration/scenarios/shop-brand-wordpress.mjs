import assert from 'node:assert/strict';

const CAPTURE = 'moda_interact_capture_woo_shop_brand';
const DELIVERY = 'moda_interact_publish_woo_shop_brand';
const GROUP = 'moda-interact-shop-brand';

/** Real WP-CLI -> WordPress hooks -> Action Scheduler -> HTTPS fixture test. */
export async function assertShopBrandWordPress({ wpAsync, parseJsonOutput, fixture }) {
	const wpJson = async (php) => parseJsonOutput(await wpAsync('eval', php));
	const drain = (hook) =>
		wpAsync('action-scheduler', 'run', `--hooks=${hook}`, '--batch-size=20', '--batches=1');
	const requests = fixture.getShopBrandRequests;
	const latest = () => {
		const entries = requests();
		assert.ok(entries.length > 0, 'the real WordPress worker must POST to the HTTPS fixture');
		return entries.at(-1);
	};
	const pending = async (hook) =>
		wpJson(`
			$actions = as_get_scheduled_actions(array(
				'hook' => '${hook}', 'group' => '${GROUP}', 'status' => 'pending', 'per_page' => 25,
			));
			$result = array();
			foreach ($actions as $id => $action) {
				$date = $action->get_schedule()->get_date();
				$result[] = array(
					'id' => (int) $id,
					'args' => array_values($action->get_args()),
					'runAt' => $date ? $date->getTimestamp() : null,
				);
			}
			echo wp_json_encode($result);
		`);
	const changeName = (name) => wpJson(`
		update_option('blogname', ${JSON.stringify(name)});
		echo wp_json_encode(array('queued' => (bool) as_has_scheduled_action('${CAPTURE}',
			array('install_wp_fixture', 'shop_wp_fixture'), '${GROUP}')));
	`);
	const requestSync = async () => {
		const result = await wpJson(`
			$publisher = new \\ModaInteract\\WooCommerce\\ShopBrand\\Publisher();
			echo wp_json_encode(array('queued' => $publisher->requestSync()));
		`);
		assert.equal(result.queued, true, 'internal requestSync() must enqueue a capture');
	};
	// Advance the test's *persisted* retry without altering production backoff.
	// The real Action Scheduler CLI then invokes the registered delivery hook.
	const advanceRetry = async (action) => {
		const encoded = Buffer.from(JSON.stringify(action.args)).toString('base64');
		const result = await wpJson(`
			$args = json_decode(base64_decode('${encoded}'), true);
			as_unschedule_action('${DELIVERY}', $args, '${GROUP}');
			$id = as_schedule_single_action(time() - 1, '${DELIVERY}', $args, '${GROUP}', true);
			echo wp_json_encode(array('id' => $id, 'args' => $args));
		`);
		assert.ok(result.id > 0, 'retry must be requeued as a real due Action Scheduler action');
		assert.deepEqual(result.args, action.args, 'retry payload must remain byte-equivalent');
		await drain(DELIVERY);
	};
	let installed = false;
	try {
		const beforeConnect = await pending(CAPTURE);
		assert.ok(
			beforeConnect.length > 0 || requests().length > 0,
			'successful connection must enqueue an initial brand snapshot'
		);
		// The background runner can drain this initial job before assertions run.
		// Validate it separately from the subsequent explicit branding sync.
		if (beforeConnect.length > 0) await drain(CAPTURE);
		assert.equal(latest().httpStatus, 200, 'initial connection publishes asynchronously');
		assert.equal(await wpJson(`echo wp_json_encode(get_option(
			'moda_interact_shop_brand_bootstrapped_installation', ''));`), 'install_wp_fixture');

		// Use native attachment posts and native Site Identity APIs; WordPress
		// itself derives the public HTTPS attachment URLs (no PHP source mocks).
		installed = true; // Cleanup can now use the persisted prior-state marker, even if setup throws.
		const setup = await wpJson(`
			$previous = array(
				'blogname' => get_option('blogname'),
				'site_icon' => get_option('site_icon'),
				'site_logo' => get_option('site_logo'),
				'custom_logo' => get_theme_mod('custom_logo'),
				'upload_url_path' => get_option('upload_url_path'),
			);
			update_option('moda_arch049_shop_brand_test_state', array(
				'previous' => $previous, 'attachments' => array(),
			), false);
			update_option('upload_url_path', 'https://media.arch049.example.test/uploads');
			wp_upload_dir(null, true, true);
			$ids = array();
			foreach (array('logo-original', 'icon-original', 'logo-replacement') as $name) {
				$id = wp_insert_attachment(array(
					'post_title' => 'ARCH049 ' . $name,
					'post_mime_type' => 'image/png',
					'post_status' => 'inherit',
				), '', 0, true);
				if (is_wp_error($id)) throw new RuntimeException('fixture_attachment_failed');
				$filename = '2026/10/arch049-' . $name . '.png';
				$width = $name === 'icon-original' ? 512 : 900;
				$height = $name === 'icon-original' ? 512 : 300;
				update_post_meta($id, '_wp_attached_file', $filename);
				update_post_meta($id, '_wp_attachment_metadata', array(
					'file' => $filename, 'width' => $width, 'height' => $height, 'sizes' => array(),
				));
				update_post_meta($id, '_wp_attachment_image_alt', 'ARCH049 ' . $name);
				$ids[$name] = (int) $id;
			}
			$state = get_option('moda_arch049_shop_brand_test_state');
			$state['attachments'] = array_values($ids);
			update_option('moda_arch049_shop_brand_test_state', $state, false);
			if (wp_is_block_theme()) {
				update_option('site_logo', $ids['logo-original']);
			} else {
				set_theme_mod('custom_logo', $ids['logo-original']);
			}
			update_option('site_icon', $ids['icon-original']);
			update_option('blogname', 'ARCH049 Original Store');
			$reader = new \\ModaInteract\\WooCommerce\\ShopBrand\\SourceReader();
			echo wp_json_encode(array(
				'ids' => $ids, 'blockTheme' => wp_is_block_theme(),
				'source' => $reader->read(),
				'publicRoutes' => array_values(array_filter(array_keys(rest_get_server()->get_routes()),
					static fn($route) => str_contains($route, 'shop-brand'))),
			));
		`);
		assert.deepEqual(setup.publicRoutes, [], 'no new public WordPress shop-brand REST route');
		assert.equal(setup.source.brandName, 'ARCH049 Original Store');
		assert.equal(setup.source.logo.attachmentId, setup.ids['logo-original']);
		assert.equal(setup.source.siteIcon.attachmentId, setup.ids['icon-original']);
		assert.equal(setup.source.logo.width, 900);
		assert.equal(setup.source.logo.height, 300);
		assert.equal(setup.source.siteIcon.width, 512);
		assert.match(setup.source.logo.url, /^https:\/\/media\.arch049\.example\.test\/uploads\//);
		assert.equal(setup.source.coverImage, null);
		assert.deepEqual(await pending(CAPTURE), [], 'Site Identity changes must not auto-enqueue');
		const beforeExplicit = requests().length;
		await requestSync();
		await requestSync(); // Two explicit requests must coalesce into one durable capture.
		assert.equal(requests().length, beforeExplicit, 'requestSync must not POST synchronously');
		assert.equal((await pending(CAPTURE)).length, 1);
		await drain(CAPTURE);
		const initial = latest();
		assert.equal(initial.httpStatus, 200);
		assert.equal(initial.disposition, 'updated');
		assert.deepEqual(initial.event.brandName, setup.source.brandName);
		assert.deepEqual(initial.event.logo, setup.source.logo);
		assert.deepEqual(initial.event.siteIcon, setup.source.siteIcon);

		// Changing WordPress Site Identity must not schedule or publish anything.
		const updated = await wpJson(`
			$syncNetworkCalls = 0;
			add_filter('pre_http_request', static function($pre, $args, $url) use (&$syncNetworkCalls) {
				if (str_contains($url, '/v1/woocommerce/shop-brand')) ++$syncNetworkCalls;
				return $pre;
			}, 10, 3);
			if (wp_is_block_theme()) {
				update_option('site_logo', ${setup.ids['logo-replacement']});
			} else {
				set_theme_mod('custom_logo', ${setup.ids['logo-replacement']});
			}
			update_option('blogname', 'ARCH049 Updated Store');
			update_post_meta(${setup.ids['logo-replacement']}, '_wp_attachment_image_alt', 'Replacement alt text');
			echo wp_json_encode(array(
				'queued' => (bool) as_has_scheduled_action('${CAPTURE}',
					array('install_wp_fixture', 'shop_wp_fixture'), '${GROUP}'),
				'syncNetworkCalls' => $syncNetworkCalls,
			));
		`);
		assert.equal(updated.queued, false, 'branding changes must not enqueue');
		assert.equal(updated.syncNetworkCalls, 0, 'branding changes must not call Moda');
		assert.deepEqual(await pending(CAPTURE), []);
		const beforeChangeSync = requests().length;
		await requestSync();
		assert.equal(requests().length, beforeChangeSync);
		await drain(CAPTURE);
		const changed = latest();
		assert.equal(changed.disposition, 'updated');
		assert.equal(changed.event.brandName, 'ARCH049 Updated Store');
		assert.equal(changed.event.logo.attachmentId, setup.ids['logo-replacement']);
		assert.equal(changed.event.logo.altText, 'Replacement alt text');
		assert.equal(changed.event.siteIcon.attachmentId, setup.ids['icon-original']);
		assert.notEqual(changed.event.eventId, initial.event.eventId);

		// Repeating an explicit request for identical sources keeps the event ID.
		await requestSync();
		await drain(CAPTURE);
		const repeat = latest();
		assert.equal(repeat.disposition, 'unchanged');
		assert.equal(repeat.event.eventId, changed.event.eventId);

		// The retired reconciliation hook must have no listener or recurring jobs.
		const legacy = await wpJson(`
			$id = as_schedule_recurring_action(time() + DAY_IN_SECONDS, DAY_IN_SECONDS,
				'moda_interact_reconcile_woo_shop_brand', array(), '${GROUP}', true);
			$publisher = new \\ModaInteract\\WooCommerce\\ShopBrand\\Publisher();
			$publisher->ensureInitialSync();
			$publisher->ensureInitialSync();
			do_action('moda_interact_reconcile_woo_shop_brand');
			echo wp_json_encode(array(
				'scheduled' => $id > 0,
				'legacyPending' => (bool) as_has_scheduled_action(
					'moda_interact_reconcile_woo_shop_brand', array(), '${GROUP}'),
				'capturePending' => (bool) as_has_scheduled_action('${CAPTURE}',
					array('install_wp_fixture', 'shop_wp_fixture'), '${GROUP}'),
			));
		`);
		assert.equal(legacy.scheduled, true);
		assert.equal(legacy.legacyPending, false, 'old recurring action must be removed');
		assert.equal(legacy.capturePending, false, 'retired reconciliation does not capture');
		assert.deepEqual(await pending(CAPTURE), []);

		// Upgrade of an already-connected store with no bootstrap marker queues once.
		const upgrade = await wpJson(`
			delete_option('moda_interact_shop_brand_bootstrapped_installation');
			$publisher = new \\ModaInteract\\WooCommerce\\ShopBrand\\Publisher();
			$publisher->ensureInitialSync();
			$publisher->ensureInitialSync();
			echo wp_json_encode(array(
				'marker' => get_option('moda_interact_shop_brand_bootstrapped_installation'),
				'queued' => (bool) as_has_scheduled_action('${CAPTURE}',
					array('install_wp_fixture', 'shop_wp_fixture'), '${GROUP}'),
			));
		`);
		assert.equal(upgrade.marker, 'install_wp_fixture');
		assert.equal(upgrade.queued, true);
		assert.equal((await pending(CAPTURE)).length, 1);
		await drain(CAPTURE);
		assert.equal(latest().disposition, 'unchanged');
		assert.deepEqual(await pending(CAPTURE), []);

		// Removal publishes null only when requested explicitly.
		await wpJson(`
			if (wp_is_block_theme()) update_option('site_logo', 0);
			else remove_theme_mod('custom_logo');
			update_option('site_icon', 0);
			echo wp_json_encode(array('removed' => true));
		`);
		assert.deepEqual(await pending(CAPTURE), []);
		await requestSync();
		await drain(CAPTURE);
		const removed = latest();
		assert.equal(removed.disposition, 'updated');
		assert.equal(removed.event.logo, null);
		assert.equal(removed.event.siteIcon, null);
		assert.equal(removed.event.coverImage, null);

		await wpJson(`
			update_option('site_icon', ${setup.ids['icon-original']});
			echo wp_json_encode(array('selected' => true));
		`);
		assert.deepEqual(await pending(CAPTURE), []);
		await requestSync();
		await drain(CAPTURE);
		assert.equal(latest().event.siteIcon.attachmentId, setup.ids['icon-original']);
		const deleted = await wpJson(`
			wp_delete_attachment(${setup.ids['icon-original']}, true);
			echo wp_json_encode(array('queued' => (bool) as_has_scheduled_action('${CAPTURE}',
				array('install_wp_fixture', 'shop_wp_fixture'), '${GROUP}')));
		`);
		assert.equal(deleted.queued, false, 'attachment deletion must not auto-enqueue');
		await requestSync();
		await drain(CAPTURE);
		assert.equal(latest().event.siteIcon, null);

		// An HTTP-only source becomes an explicit null, never silently HTTPS.
		await wpJson(`
			if (wp_is_block_theme()) update_option('site_logo', ${setup.ids['logo-replacement']});
			else set_theme_mod('custom_logo', ${setup.ids['logo-replacement']});
			update_option('upload_url_path', 'http://media.arch049.example.test/uploads');
			wp_upload_dir(null, true, true);
			echo wp_json_encode(array('httpSource' => true));
		`);
		assert.deepEqual(await pending(CAPTURE), []);
		await requestSync();
		await drain(CAPTURE);
		assert.equal(latest().event.logo, null, 'HTTP logo must be an explicit null');
		await wpJson(`
			update_option('upload_url_path', 'https://media.arch049.example.test/uploads');
			wp_upload_dir(null, true, true);
			echo wp_json_encode(array('restored' => true));
		`);

		async function transientRetry(status, name) {
			fixture.setShopBrandStatus(status);
			assert.equal((await changeName(name)).queued, false);
			await requestSync();
			await drain(CAPTURE);
			const failed = latest();
			assert.equal(failed.httpStatus, status);
			assert.equal(failed.event.brandName, name);
			const actions = await pending(DELIVERY);
			assert.equal(actions.length, 1, `${status}: one durable retry`);
			const retry = actions[0];
			assert.equal(retry.args[3], 2, 'attempt 2 must be queued');
			assert.deepEqual(retry.args[0], failed.event, 'event and observedAt stay unchanged');
			assert.equal(retry.args[1], 'install_wp_fixture');
			assert.equal(retry.args[2], 'shop_wp_fixture');
			assert.ok(Math.abs(retry.runAt - Date.now() / 1000 - 20) < 15);
			assert.ok(!JSON.stringify(retry.args).includes('credential'));
			if (status === 429) {
				// A second transient response advances to attempt 3 with a
				// 60-second backoff, without recapturing live WordPress state.
				fixture.setShopBrandStatus(503);
				await advanceRetry(retry);
				assert.equal(latest().httpStatus, 503);
				const third = await pending(DELIVERY);
				assert.equal(third.length, 1);
				assert.equal(third[0].args[3], 3);
				assert.deepEqual(third[0].args[0], failed.event);
				assert.ok(Math.abs(third[0].runAt - Date.now() / 1000 - 60) < 15);
				fixture.setShopBrandStatus(200);
				await advanceRetry(third[0]);
			} else {
				fixture.setShopBrandStatus(200);
				await advanceRetry(retry);
			}
			const succeeded = latest();
			assert.equal(succeeded.httpStatus, 200);
			assert.equal(succeeded.disposition, 'updated');
			assert.deepEqual(succeeded.event, failed.event);
			assert.deepEqual(await pending(DELIVERY), []);
		}
		await transientRetry(503, 'ARCH049 503 retry');
		await transientRetry(429, 'ARCH049 429 retry');

		fixture.setShopBrandStatus(400);
		assert.equal((await changeName('ARCH049 permanent rejection')).queued, false);
		await requestSync();
		await drain(CAPTURE);
		assert.equal(latest().httpStatus, 400);
		assert.deepEqual(await pending(DELIVERY), [], 'permanent 4xx must not be retried');
		fixture.setShopBrandStatus(200);

		// An old retry must not publish after a different installation claims
		// the local WP site, even if its event object remains in the queue.
		fixture.setShopBrandStatus(503);
		assert.equal((await changeName('ARCH049 stale installation')).queued, false);
		await requestSync();
		await drain(CAPTURE);
		const stale = (await pending(DELIVERY))[0];
		assert.ok(stale);
		fixture.setShopBrandStatus(200);
		const countBeforeStale = requests().length;
		await wpJson(`
			$connection = get_option('moda_interact_woocommerce_connection');
			$connection['installationId'] = 'arch049-other-installation';
			update_option('moda_interact_woocommerce_connection', $connection, false);
			// Keep the replacement installation marked as already bootstrapped.
			update_option('moda_interact_shop_brand_bootstrapped_installation', 'arch049-other-installation', false);
			echo wp_json_encode(array('installationId' => $connection['installationId']));
		`);
		try {
			await advanceRetry(stale);
			assert.equal(requests().length, countBeforeStale, 'stale installation retry must be suppressed');
		} finally {
			await wpJson(`
				$connection = get_option('moda_interact_woocommerce_connection');
				$connection['installationId'] = 'install_wp_fixture';
				update_option('moda_interact_woocommerce_connection', $connection, false);
				update_option('moda_interact_shop_brand_bootstrapped_installation', 'install_wp_fixture', false);
				echo wp_json_encode(array('installationId' => $connection['installationId']));
			`);
		}

		process.stdout.write(
			'ARCH-049 Woo ShopBrand native WordPress + Action Scheduler + authenticated HTTPS integration PASS\n'
		);
	} finally {
		fixture.setShopBrandStatus(200);
		if (installed) {
			// Restore site identity for the rest of the existing WordPress suite,
			// even when an assertion fails. This runs only in disposable wp-env.
			await wpAsync('eval', `
				$connection = get_option('moda_interact_woocommerce_connection');
				if (is_array($connection) && ($connection['installationId'] ?? null) === 'arch049-other-installation') {
					$connection['installationId'] = 'install_wp_fixture';
					update_option('moda_interact_woocommerce_connection', $connection, false);
					update_option('moda_interact_shop_brand_bootstrapped_installation', 'install_wp_fixture', false);
				}
				$state = get_option('moda_arch049_shop_brand_test_state');
				if (is_array($state)) {
					$previous = $state['previous'];
					update_option('blogname', $previous['blogname']);
					update_option('site_icon', $previous['site_icon']);
					update_option('site_logo', $previous['site_logo']);
					if ($previous['custom_logo']) set_theme_mod('custom_logo', $previous['custom_logo']);
					else remove_theme_mod('custom_logo');
					update_option('upload_url_path', $previous['upload_url_path']);
					foreach ($state['attachments'] as $id) wp_delete_attachment($id, true);
					delete_option('moda_arch049_shop_brand_test_state');
				}
				as_unschedule_all_actions('${CAPTURE}', array(), '${GROUP}');
				as_unschedule_all_actions('${DELIVERY}', array(), '${GROUP}');
			`);
		}
	}
}
