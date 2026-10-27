<?php

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\BootstrapAttemptStore;
use ModaInteract\WooCommerce\Connection\ConnectionCoordinator;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Security\Base64Url;
use ModaInteract\WooCommerce\ShopBrand\Publisher;
use ModaInteract\WooCommerce\ShopBrand\SnapshotBuilder;
use ModaInteract\WooCommerce\ShopBrand\SourceReader;
use PHPUnit\Framework\TestCase;

require_once dirname( __DIR__ ) . '/includes/ShopBrand/Publisher.php';

// These functions are WordPress core / WooCommerce Action Scheduler in production.
if ( ! function_exists( 'did_action' ) ) {
	function did_action( $hook ) {
		return 'action_scheduler_init' === $hook && ! empty( $GLOBALS['arch049_scheduler_ready'] ) ? 1 : 0;
	}
}
if ( ! function_exists( 'get_bloginfo' ) ) {
	function get_bloginfo( $key ) { return 'name' === $key ? get_option( 'blogname', '' ) : ''; }
}
if ( ! function_exists( 'get_theme_mod' ) ) {
	function get_theme_mod( $key, $default = false ) { return $GLOBALS['arch049_theme_mods'][ $key ] ?? $default; }
}
if ( ! function_exists( 'wp_is_block_theme' ) ) {
	function wp_is_block_theme() { return $GLOBALS['arch049_block_theme'] ?? false; }
}
if ( ! function_exists( 'wp_get_attachment_image_url' ) ) {
	function wp_get_attachment_image_url( $id, $size = 'thumbnail' ) { return $GLOBALS['arch049_attachments'][ $id ]['url'] ?? false; }
}
if ( ! function_exists( 'wp_get_attachment_metadata' ) ) {
	function wp_get_attachment_metadata( $id ) { return $GLOBALS['arch049_attachments'][ $id ]['metadata'] ?? false; }
}
if ( ! function_exists( 'get_post_meta' ) ) {
	function get_post_meta( $id, $key, $single = false ) { return $GLOBALS['arch049_attachments'][ $id ]['alt'] ?? ''; }
}
if ( ! function_exists( 'get_site_icon_url' ) ) {
	function get_site_icon_url() { return $GLOBALS['arch049_icon_url'] ?? false; }
}
if ( ! function_exists( 'as_enqueue_async_action' ) ) {
	function as_enqueue_async_action( $hook, $args, $group, $unique ) {
		if ( ! empty( $GLOBALS['arch035_async_fail'] ) ) throw new \RuntimeException( 'Action Scheduler unavailable' );
		$GLOBALS['arch035_queued'][] = compact( 'hook', 'args', 'group', 'unique' );
		return count( $GLOBALS['arch035_queued'] );
	}
}
if ( ! function_exists( 'as_schedule_single_action' ) ) {
	function as_schedule_single_action( $timestamp, $hook, $args, $group, $unique ) {
		$GLOBALS['arch035_delayed'][] = compact( 'timestamp', 'hook', 'args', 'group', 'unique' );
		$GLOBALS['arch046_scheduled'][] = compact( 'timestamp', 'hook', 'args', 'group', 'unique' );
		return count( $GLOBALS['arch035_delayed'] );
	}
}
if ( ! function_exists( 'as_schedule_recurring_action' ) ) {
	function as_schedule_recurring_action( $timestamp, $interval, $hook, $args, $group, $unique ) {
		$GLOBALS['arch049_recurring'][] = compact( 'timestamp', 'interval', 'hook', 'args', 'group', 'unique' );
		return count( $GLOBALS['arch049_recurring'] );
	}
}
if ( ! function_exists( 'as_unschedule_all_actions' ) ) {
	function as_unschedule_all_actions( $hook, $args = array(), $group = '' ) {
		$GLOBALS['arch049_unscheduled'][] = compact( 'hook', 'args', 'group' );
		foreach ( array( 'arch049_recurring', 'arch035_queued', 'arch035_delayed' ) as $key ) {
			$GLOBALS[ $key ] = array_values( array_filter(
				$GLOBALS[ $key ] ?? array(),
				static fn( $action ) => $action['hook'] !== $hook || $action['args'] !== $args || $action['group'] !== $group
			) );
		}
	}
}
if ( ! function_exists( 'as_has_scheduled_action' ) ) {
	function as_has_scheduled_action( $hook, $args, $group ) {
		foreach ( array_merge( $GLOBALS['arch035_queued'] ?? array(), $GLOBALS['arch035_delayed'] ?? array(), $GLOBALS['arch049_recurring'] ?? array() ) as $item ) {
			if ( $item['hook'] === $hook && $item['args'] === $args && $item['group'] === $group ) return true;
		}
		return false;
	}
}
final class Arch049TestLogger {
	public function warning( string $message, array $context = array() ): void {
		$GLOBALS['arch049_logs'][] = array( 'message' => $message, 'context' => $context );
	}
}
if ( ! function_exists( 'wc_get_logger' ) ) {
	function wc_get_logger() { return new Arch049TestLogger(); }
}

final class ShopBrandPublicationTest extends TestCase {
	private array $record;
	private InstallationStore $store;
	private SiteIdentity $identity;

	protected function setUp(): void {
		$GLOBALS['moda_interact_options'] = array( 'blogname' => '  Sample Store  ', 'site_icon' => 22 );
		$GLOBALS['moda_interact_option_autoload'] = array();
		$GLOBALS['moda_interact_home_url'] = 'https://merchant.example';
		$GLOBALS['moda_interact_fail_option_writes'] = false;
		$GLOBALS['arch049_block_theme'] = false;
		$GLOBALS['arch049_scheduler_ready'] = true;
		$GLOBALS['arch049_theme_mods'] = array( 'custom_logo' => 11 );
		$GLOBALS['arch049_attachments'] = array(
			11 => array( 'url' => 'https://merchant.example/uploads/logo.png', 'metadata' => array( 'width' => 1200, 'height' => 350 ), 'alt' => 'Logo' ),
			22 => array( 'url' => 'https://merchant.example/uploads/icon.png', 'metadata' => array( 'width' => 512, 'height' => 512 ), 'alt' => '' ),
			33 => array( 'url' => 'https://merchant.example/uploads/block-logo.webp', 'metadata' => array( 'width' => 700, 'height' => 200 ), 'alt' => 'Block logo' ),
		);
		$GLOBALS['arch049_icon_url'] = 'https://merchant.example/uploads/icon-512.png';
		$GLOBALS['arch049_recurring'] = array();
		$GLOBALS['arch049_unscheduled'] = array();
		$GLOBALS['moda_interact_test_hooks'] = array();
		$GLOBALS['arch049_logs'] = array();
		$GLOBALS['arch035_queued'] = array();
		$GLOBALS['arch035_delayed'] = array();
		$GLOBALS['arch046_scheduled'] = array();
		$GLOBALS['arch035_async_fail'] = false;
		$this->record = array(
			'schemaVersion' => 1,
			'installationId' => 'woo-install-1',
			'shopId' => 'shop-1',
			'canonicalSiteUrl' => 'https://merchant.example',
			'credential' => Base64Url::encode( str_repeat( "\x05", 32 ) ),
			'credentialVersion' => 1,
			'connectedAt' => '2026-10-27T09:00:00Z',
		);
		$this->store = new InstallationStore();
		self::assertTrue( $this->store->save( $this->record ) );
		$this->identity = new SiteIdentity( ModaApiConfiguration::MODE_PUBLIC, static fn() => array( '93.184.216.34' ) );
	}

	public function test_classic_theme_reads_exact_native_brand_sources_without_theme_scraping(): void {
		$read = ( new SourceReader() )->read();
		self::assertSame( 'Sample Store', $read['brandName'] );
		self::assertSame( array(
			'url' => 'https://merchant.example/uploads/logo.png', 'attachmentId' => 11,
			'altText' => 'Logo', 'width' => 1200, 'height' => 350,
		), $read['logo'] );
		self::assertSame( array(
			'url' => 'https://merchant.example/uploads/icon-512.png', 'attachmentId' => 22,
			'altText' => null, 'width' => 512, 'height' => 512,
		), $read['siteIcon'] );
		self::assertNull( $read['coverImage'] );
	}

	public function test_block_theme_uses_site_logo_and_explicitly_clears_deleted_and_http_assets(): void {
		$GLOBALS['arch049_block_theme'] = true;
		$GLOBALS['moda_interact_options']['site_logo'] = 33;
		$reader = new SourceReader();
		self::assertSame( 33, $reader->read()['logo']['attachmentId'] );
		unset( $GLOBALS['arch049_attachments'][33] );
		self::assertNull( $reader->read()['logo'] );
		unset( $GLOBALS['moda_interact_options']['site_logo'] );
		// Classic-theme custom_logo must not resurrect a removed block Site Logo.
		self::assertNull( $reader->read()['logo'] );
		$GLOBALS['arch049_attachments'][11]['url'] = 'http://merchant.example/uploads/logo.png';
		unset( $GLOBALS['moda_interact_options']['site_logo'] );
		self::assertNull( $reader->read()['logo'] );
		$GLOBALS['arch049_icon_url'] = 'http://merchant.example/uploads/icon.png';
		self::assertNull( $reader->read()['siteIcon'] );
		$GLOBALS['moda_interact_options']['site_icon'] = 0;
		self::assertNull( $reader->read()['siteIcon'] );
	}

	public function test_snapshot_has_stable_digest_no_installation_secrets_and_preserves_retry_time(): void {
		$builder = new SnapshotBuilder();
		$first = $builder->build( $this->record['installationId'], ( new SourceReader() )->read(), '2026-10-27T09:30:00.123456Z' );
		$second = $builder->build( $this->record['installationId'], ( new SourceReader() )->read(), '2026-10-27T09:30:02.123456Z' );
		self::assertTrue( SnapshotBuilder::valid( $first ) );
		self::assertSame( $first['eventId'], $second['eventId'] );
		self::assertSame( '2026-10-27T09:30:00.123456Z', $first['observedAt'] );
		self::assertArrayNotHasKey( 'shopId', $first );
		self::assertArrayNotHasKey( 'installationId', $first );
		self::assertArrayNotHasKey( 'credential', $first );
		$GLOBALS['moda_interact_options']['blogname'] = 'Another name';
		self::assertNotSame( $first['eventId'], $builder->capture( $this->record['installationId'] )['eventId'] );
		$invalid = $first;
		$invalid['shopId'] = 'cross-tenant';
		self::assertFalse( SnapshotBuilder::valid( $invalid ) );
	}

	public function test_auth_client_posts_frozen_contract_and_handles_updated_unchanged_and_invalid_responses(): void {
		$requests = array();
		$result_status = 'updated';
		$client = $this->client( static function ( string $url, array $args ) use ( &$requests, &$result_status ): array {
			$requests[] = array( $url, $args );
			return self::http( 200, array( 'status' => $result_status ) );
		} );
		$event = ( new SnapshotBuilder() )->capture( $this->record['installationId'] );
		self::assertSame( array( 'status' => 'updated' ), $client->publishShopBrand( $this->record, $event ) );
		$result_status = 'unchanged';
		self::assertSame( array( 'status' => 'unchanged' ), $client->publishShopBrand( $this->record, $event ) );
		self::assertSame( 'https://api.example.test/v1/woocommerce/shop-brand', $requests[0][0] );
		self::assertSame( 'POST', $requests[0][1]['method'] );
		self::assertSame( 'Bearer ' . $this->record['credential'], $requests[0][1]['headers']['Authorization'] );
		self::assertSame( $this->record['installationId'], $requests[0][1]['headers']['X-Moda-Installation-Id'] );
		self::assertArrayNotHasKey( 'X-Shop-Id', $requests[0][1]['headers'] );
		self::assertSame( $event, json_decode( $requests[0][1]['body'], true ) );
		self::assertSame( 0, $requests[0][1]['redirection'] );
		self::assertTrue( $requests[0][1]['sslverify'] );
		self::assertLessThanOrEqual( 16384, strlen( $requests[0][1]['body'] ) );
		$forged = $event;
		$forged['shopId'] = 'other-shop';
		try {
			$client->publishShopBrand( $this->record, $forged );
			self::fail( 'Caller shopId must not pass client validation' );
		} catch ( ModaApiClientException $error ) {
			self::assertSame( 'invalid_request', $error->getMessage() );
		}
		self::assertCount( 2, $requests );
		$result_status = 'bogus';
		try {
			$client->publishShopBrand( $this->record, $event );
			self::fail( 'Invalid response must be rejected' );
		} catch ( ModaApiClientException $error ) {
			self::assertSame( 'remote_response_invalid', $error->getMessage() );
		}
	}

	public function test_successful_connection_enqueues_brand_without_posting_it_in_the_rest_request(): void {
		$GLOBALS['moda_interact_options']['permalink_structure'] = '/%postname%/';
		$GLOBALS['moda_interact_transients'] = array();
		$urls = array();
		$client = $this->client( function ( string $url, array $args ) use ( &$urls ): array {
			$urls[] = $url;
			return self::http( 201, array(
				'installationId' => $this->record['installationId'],
				'shopId' => $this->record['shopId'],
				'canonicalSiteUrl' => $this->record['canonicalSiteUrl'],
				'credential' => $this->record['credential'],
				'credentialVersion' => 1,
				'connection' => 'CREATED',
			) );
		} );
		$coordinator = new ConnectionCoordinator( $this->identity, new BootstrapAttemptStore(), $this->store, $client );
		self::assertSame( 'CONNECTED', $coordinator->connect()['status'] );
		self::assertSame( array( 'https://api.example.test/v1/woocommerce/installations/connect' ), $urls );
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		self::assertSame( Publisher::CAPTURE_ACTION, $GLOBALS['arch035_queued'][0]['hook'] );
		self::assertSame( array( $this->record['installationId'], $this->record['shopId'] ), $GLOBALS['arch035_queued'][0]['args'] );
		self::assertArrayNotHasKey( 'credential', $GLOBALS['arch035_queued'][0]['args'] );
	}

	public function test_deleted_icon_is_published_as_complete_null_source(): void {
		$observations = array();
		$client = $this->client( static function ( string $url, array $args ) use ( &$observations ): array {
			$observations[] = json_decode( $args['body'], true );
			return self::http( 200, array( 'status' => 'updated' ) );
		} );
		$publisher = new Publisher( $client, $this->store, $this->identity );
		$publisher->capture( $this->record['installationId'], $this->record['shopId'] );
		unset( $GLOBALS['arch049_attachments'][22] );
		$publisher->capture( $this->record['installationId'], $this->record['shopId'] );
		self::assertCount( 2, $observations );
		self::assertSame( 22, $observations[0]['siteIcon']['attachmentId'] );
		self::assertNull( $observations[1]['siteIcon'] );
		self::assertNull( $observations[1]['coverImage'] );
		self::assertNotSame( $observations[0]['eventId'], $observations[1]['eventId'] );
	}

	public function test_network_transport_failure_is_bounded_and_logged_without_credentials(): void {
		$client = $this->client( static fn() => new \WP_Error( 'http_request_failed', 'secret failure body' ) );
		$publisher = new Publisher( $client, $this->store, $this->identity );
		$publisher->capture( $this->record['installationId'], $this->record['shopId'] );
		self::assertCount( 1, $GLOBALS['arch035_delayed'] );
		self::assertStringNotContainsString( 'secret failure body', json_encode( $GLOBALS['arch049_logs'] ) );
		self::assertStringNotContainsString( $this->record['credential'], json_encode( $GLOBALS['arch049_logs'] ) );
	}

	public function test_initial_connection_bootstrap_is_once_only_and_registers_no_change_or_daily_hooks(): void {
		$publisher = new Publisher( null, $this->store, $this->identity );
		$publisher->register();
		self::assertArrayHasKey( Publisher::CAPTURE_ACTION, $GLOBALS['moda_interact_test_hooks'] );
		self::assertArrayHasKey( Publisher::DELIVERY_ACTION, $GLOBALS['moda_interact_test_hooks'] );
		self::assertArrayHasKey( 'action_scheduler_init', $GLOBALS['moda_interact_test_hooks'] );
		foreach ( array(
			'updated_option', 'added_option', 'deleted_option', 'switch_theme',
			'edit_attachment', 'delete_attachment', 'updated_post_meta',
			'added_post_meta', 'deleted_post_meta',
			'moda_interact_reconcile_woo_shop_brand',
		) as $hook ) {
			self::assertArrayNotHasKey( $hook, $GLOBALS['moda_interact_test_hooks'] );
		}
		$publisher->connected( $this->record );
		$publisher->connected( $this->record );
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		self::assertSame( Publisher::CAPTURE_ACTION, $GLOBALS['arch035_queued'][0]['hook'] );
		self::assertSame( $this->record['installationId'], get_option( 'moda_interact_shop_brand_bootstrapped_installation' ) );
		self::assertFalse( $GLOBALS['moda_interact_option_autoload']['moda_interact_shop_brand_bootstrapped_installation'] );
		$GLOBALS['arch035_queued'] = array(); // The first capture has run.
		$publisher->ensureInitialSync();
		$publisher->ensureInitialSync();
		self::assertCount( 0, $GLOBALS['arch035_queued'] );
		self::assertCount( 0, $GLOBALS['arch049_recurring'] );
	}

	public function test_early_woocommerce_initialization_waits_for_action_scheduler_data_store(): void {
		$GLOBALS['arch049_scheduler_ready'] = false;
		$publisher = new Publisher( null, $this->store, $this->identity );
		$publisher->register();
		$publisher->ensureInitialSync();
		$publisher->connected( $this->record );
		self::assertCount( 0, $GLOBALS['arch035_queued'] );
		self::assertSame( '', get_option( 'moda_interact_shop_brand_bootstrapped_installation', '' ) );

		// WordPress/WooCommerce invokes this after Action Scheduler has a store.
		$GLOBALS['arch049_scheduler_ready'] = true;
		foreach ( $GLOBALS['moda_interact_test_hooks']['action_scheduler_init'] as $callback ) {
			$callback();
		}
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		self::assertSame( $this->record['installationId'], get_option( 'moda_interact_shop_brand_bootstrapped_installation' ) );
		$GLOBALS['arch035_queued'] = array();
		$publisher->ensureInitialSync();
		self::assertCount( 0, $GLOBALS['arch035_queued'] );
	}

	public function test_registration_after_scheduler_initialization_bootstraps_existing_connection(): void {
		$publisher = new Publisher( null, $this->store, $this->identity );
		$publisher->register();
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		self::assertSame( $this->record['installationId'], get_option( 'moda_interact_shop_brand_bootstrapped_installation' ) );
	}

	public function test_reconnecting_the_same_installation_does_not_recapture_branding(): void {
		$publisher = new Publisher( null, $this->store, $this->identity );
		$publisher->connected( $this->record );
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		$GLOBALS['arch035_queued'] = array();
		$publisher->connected( $this->record );
		self::assertCount( 0, $GLOBALS['arch035_queued'] );
	}

	public function test_upgrade_bootstrap_only_when_connected_and_retry_when_scheduler_recovers(): void {
		$publisher = new Publisher( null, $this->store, $this->identity );
		delete_option( InstallationStore::OPTION_NAME );
		$publisher->ensureInitialSync(); // Activated but not connected to Moda.
		self::assertCount( 0, $GLOBALS['arch035_queued'] );
		self::assertTrue( $this->store->save( $this->record ) );
		$GLOBALS['arch035_async_fail'] = true;
		$publisher->ensureInitialSync();
		self::assertSame( '', get_option( 'moda_interact_shop_brand_bootstrapped_installation', '' ) );
		$GLOBALS['arch035_async_fail'] = false;
		$publisher->ensureInitialSync();
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		self::assertSame( $this->record['installationId'], get_option( 'moda_interact_shop_brand_bootstrapped_installation' ) );
		$GLOBALS['arch035_queued'] = array();
		$publisher->ensureInitialSync();
		self::assertCount( 0, $GLOBALS['arch035_queued'] );
		self::assertCount( 0, $GLOBALS['arch049_recurring'] );
	}

	public function test_existing_daily_reconciliation_is_cancelled_during_upgrade(): void {
		$GLOBALS['arch049_recurring'][] = array(
			'hook' => 'moda_interact_reconcile_woo_shop_brand',
			'args' => array(), 'group' => 'moda-interact-shop-brand',
			'interval' => 86400, 'timestamp' => time() + 86400, 'unique' => true,
		);
		$publisher = new Publisher( null, $this->store, $this->identity );
		$publisher->ensureInitialSync();
		self::assertCount( 0, $GLOBALS['arch049_recurring'] );
		self::assertSame( array(
			'hook' => 'moda_interact_reconcile_woo_shop_brand',
			'args' => array(), 'group' => 'moda-interact-shop-brand',
		), $GLOBALS['arch049_unscheduled'][0] );
		$publisher->ensureInitialSync();
		self::assertCount( 1, $GLOBALS['arch049_unscheduled'] );
	}

	public function test_explicit_manual_request_reuses_current_capture_without_auto_change_tracking(): void {
		$observations = array();
		$client = $this->client( static function ( string $url, array $args ) use ( &$observations ): array {
			$observations[] = json_decode( $args['body'], true );
			return self::http( 200, array( 'status' => 'updated' ) );
		} );
		$publisher = new Publisher( $client, $this->store, $this->identity );
		$publisher->register();
		$publisher->connected( $this->record );
		$publisher->capture( ...$GLOBALS['arch035_queued'][0]['args'] );
		$GLOBALS['arch035_queued'] = array();
		$GLOBALS['moda_interact_options']['blogname'] = 'New merchant branding';
		$publisher->ensureInitialSync(); // No automatic capture on changed WP setting.
		self::assertCount( 0, $GLOBALS['arch035_queued'] );
		self::assertCount( 1, $observations );
		self::assertTrue( $publisher->requestSync() );
		self::assertTrue( $publisher->requestSync() ); // Coalesce the same manual request.
		self::assertCount( 1, $GLOBALS['arch035_queued'] );
		self::assertArrayNotHasKey( 'credential', $GLOBALS['arch035_queued'][0]['args'] );
		$publisher->capture( ...$GLOBALS['arch035_queued'][0]['args'] );
		self::assertCount( 2, $observations );
		self::assertSame( 'New merchant branding', $observations[1]['brandName'] );
		self::assertNotSame( $observations[0]['eventId'], $observations[1]['eventId'] );
		self::assertCount( 0, $GLOBALS['arch049_recurring'] );
	}

	public function test_retry_reuses_immutable_event_and_stops_on_permanent_failure(): void {
		$requests = array();
		$status = 503;
		$client = $this->client( static function ( string $url, array $args ) use ( &$requests, &$status ): array {
			$requests[] = array( $url, $args );
			return self::http( $status, array( 'error' => 'unavailable' ) );
		} );
		$publisher = new Publisher( $client, $this->store, $this->identity );
		$publisher->capture( $this->record['installationId'], $this->record['shopId'] );
		self::assertCount( 1, $GLOBALS['arch035_delayed'] );
		$first = $GLOBALS['arch035_delayed'][0];
		self::assertLessThanOrEqual( 1, abs( $first['timestamp'] - time() - 20 ) );
		self::assertSame( 2, $first['args'][3] );
		self::assertSame( json_decode( $requests[0][1]['body'], true ), $first['args'][0] );
		$status = 429;
		$publisher->deliver( ...array_values( $first['args'] ) );
		self::assertCount( 2, $GLOBALS['arch035_delayed'] );
		self::assertLessThanOrEqual( 1, abs( $GLOBALS['arch035_delayed'][1]['timestamp'] - time() - 60 ) );
		self::assertSame( $requests[0][1]['body'], $requests[1][1]['body'] );
		$status = 400;
		$publisher->deliver( ...array_values( $GLOBALS['arch035_delayed'][1]['args'] ) );
		self::assertCount( 2, $GLOBALS['arch035_delayed'] );
		self::assertCount( 3, $requests );
		$serialized_logs = json_encode( $GLOBALS['arch049_logs'] );
		self::assertStringNotContainsString( $this->record['credential'], $serialized_logs );
		self::assertStringNotContainsString( 'https://merchant.example/uploads/', $serialized_logs );
	}

	public function test_retry_budget_and_changed_installation_prevent_stale_delivery(): void {
		$requests = array();
		$client = $this->client( static function ( string $url, array $args ) use ( &$requests ): array {
			$requests[] = $args;
			return self::http( 408, array( 'error' => 'timeout' ) );
		} );
		$publisher = new Publisher( $client, $this->store, $this->identity );
		$publisher->capture( $this->record['installationId'], $this->record['shopId'] );
		for ( $attempt = 2; $attempt <= 5; ++$attempt ) {
			$retry = end( $GLOBALS['arch035_delayed'] );
			self::assertSame( $attempt, $retry['args'][3] );
			$publisher->deliver( ...array_values( $retry['args'] ) );
		}
		self::assertCount( 4, $GLOBALS['arch035_delayed'] );
		self::assertCount( 5, $requests );
		$GLOBALS['arch035_delayed'] = array();
		$GLOBALS['moda_interact_home_url'] = 'https://cloned.example';
		$publisher->capture( $this->record['installationId'], $this->record['shopId'] );
		self::assertCount( 5, $requests );
		$GLOBALS['moda_interact_home_url'] = 'https://merchant.example';
		$reconnected = $this->record;
		$reconnected['installationId'] = 'other-installation';
		self::assertTrue( $this->store->save( $reconnected ) );
		$publisher->capture( $this->record['installationId'], $this->record['shopId'] );
		self::assertCount( 5, $requests );
	}

	private function client( callable $transport ): ModaApiClient {
		return new ModaApiClient( ModaApiConfiguration::fromServerConfiguration( 'https://api.example.test' ), $transport );
	}

	private static function http( int $status, array $payload ): array {
		return array(
			'headers' => array( 'content-type' => 'application/json' ),
			'body' => json_encode( $payload ),
			'response' => array( 'code' => $status ),
		);
	}
}
