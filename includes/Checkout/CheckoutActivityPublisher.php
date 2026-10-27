<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Api\ModaApiClientException;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Connection\InstallationStore;
use ModaInteract\WooCommerce\Connection\SiteIdentity;

/** Woo Action Scheduler owns the durable retry payload. Never block checkout on HTTP. */
final class CheckoutActivityPublisher {
	public const ACTION = 'moda_interact_dispatch_checkout_activity';
	private const GROUP = 'moda-interact-activity';
	private const MAX_ATTEMPTS = 4;

	public function __construct(
		private readonly ?ModaApiClient $api = null,
		private readonly ?InstallationStore $installations = null,
		private readonly ?SiteIdentity $site_identity = null
	) {}

	public function register(): void {
		add_action( self::ACTION, array( $this, 'deliver' ), 10, 4 );
	}

	public function enqueue( array $snapshot, string $checkout_key ): bool {
		$event = array(
			'schemaVersion' => 'woo.activity.v1',
			'eventId' => 'woo-' . bin2hex( random_bytes( 16 ) ),
			'eventType' => 'CHECKOUT_UPDATED',
			'checkoutKey' => $checkout_key,
			'occurredAt' => ( new \DateTimeImmutable( 'now', new \DateTimeZone( 'UTC' ) ) )->format( 'Y-m-d\TH:i:s.v\Z' ),
			'checkout' => $snapshot,
		);
		// API-001's authenticated HTTP v2 envelope binds the activity to the
		// *same* exact recipient normaliser as consent. The Background queue stays v1.
		$contact = $event['checkout']['contact'] ?? null;
		if ( is_array( $contact ) && isset( $contact['phone'] ) ) {
			$country = null;
			$customer = function_exists( 'WC' ) ? ( WC()->customer ?? null ) : null;
			if ( is_object( $customer ) && method_exists( $customer, 'get_billing_country' ) ) {
				$country = CheckoutConsentPhone::verifiedCountry( $customer->get_billing_country() );
			}
			$canonical = CheckoutConsentPhone::normalize( $contact['phone'], $country );
			if ( null !== $canonical ) {
				$event['schemaVersion'] = 'woo.activity.v2';
				$event['checkout']['contact']['canonicalPhone'] = $canonical;
				if ( null !== $country ) $event['checkout']['contact']['verifiedCountryCode'] = $country;
			}
		}
		return $this->queue( $event );
	}

	/** Order events use the same Action Scheduler hook, installation check and retry path. */
	public function enqueueOrder( array $event ): bool {
		if ( ! self::validOrderEvent( $event ) ) return false;
		return $this->queue( $event );
	}

	private function queue( array $event ): bool {
		if ( ! function_exists( 'as_enqueue_async_action' ) ) return false;
		$installed = ( $this->installations ?? new InstallationStore() )->read();
		if ( 'valid' !== $installed['state'] ) return false;
		$record = $installed['record'];
		$json = wp_json_encode( $event );
		if ( ! is_string( $json ) || strlen( $json ) > 65536 ) return false;
		try {
			$id = as_enqueue_async_action( self::ACTION,
				array( 'event' => $event, 'installationId' => $record['installationId'], 'shopId' => $record['shopId'], 'attempt' => 1 ), self::GROUP, true );
			return is_numeric( $id ) && (int) $id > 0;
		} catch ( \Throwable $error ) {
			self::log( 'enqueue_failed' );
			return false;
		}
	}

	/** Each action retries the *identical* bounded event with its original eventId. */
	public function deliver( array $event, string $installation_id, string $shop_id, int $attempt ): void {
		if ( $attempt < 1 || $attempt > self::MAX_ATTEMPTS || ! self::validActivityEvent( $event ) ) return;
		$current = ( $this->installations ?? new InstallationStore() )->read();
		if ( 'valid' !== $current['state'] || $current['record']['shopId'] !== $shop_id ||
			$current['record']['installationId'] !== $installation_id ) {
			self::log( 'installation_changed' );
			return;
		}
		try {
			$identity = $this->site_identity ?? new SiteIdentity( ModaApiConfiguration::serverMode() );
			if ( $identity->currentCanonicalUrl() !== $current['record']['canonicalSiteUrl'] ) {
				self::log( 'site_identity_changed' );
				return;
			}
		} catch ( \Throwable $error ) {
			self::log( 'site_identity_unavailable' );
			return;
		}
		try {
			$configuration = $this->api ? null : ModaApiConfiguration::fromServerConfiguration();
			$client = $this->api ?? ( $configuration ? new ModaApiClient( $configuration ) : null );
			if ( ! $client ) throw new \RuntimeException( 'configuration unavailable' );
			$client->publishActivity( $current['record'], $event );
			return;
		} catch ( \Throwable $error ) {
			// 4xx are permanent; 503/transport failures remain eligible for bounded retry.
			if ( $error instanceof ModaApiClientException && $error->http_status !== null &&
				$error->http_status >= 400 && $error->http_status < 500 && ! in_array( $error->http_status, array( 408, 429 ), true ) ) {
				self::log( 'rejected' );
				return;
			}
		}
		if ( $attempt >= self::MAX_ATTEMPTS || ! function_exists( 'as_schedule_single_action' ) ) {
			self::log( 'retry_exhausted' );
			return;
		}
		try {
			$delay = array( 1 => 60, 2 => 300, 3 => 900 )[ $attempt ];
			$id = as_schedule_single_action( time() + $delay, self::ACTION,
				array( 'event' => $event, 'installationId' => $installation_id, 'shopId' => $shop_id, 'attempt' => $attempt + 1 ), self::GROUP, true );
			if ( ! is_numeric( $id ) || (int) $id < 1 ) self::log( 'retry_schedule_failed' );
		} catch ( \Throwable $error ) {
			self::log( 'retry_schedule_failed' );
		}
	}

	private static function validActivityEvent( array $event ): bool {
		return in_array( $event['schemaVersion'] ?? null, array( 'woo.activity.v1', 'woo.activity.v2' ), true ) &&
			( $event['schemaVersion'] !== 'woo.activity.v2' || ( $event['eventType'] ?? null ) === 'CHECKOUT_UPDATED' ) &&
			CheckoutKey::valid( $event['eventId'] ?? null ) &&
			CheckoutKey::valid( $event['checkoutKey'] ?? null ) &&
			( ( ( $event['eventType'] ?? null ) === 'CHECKOUT_UPDATED' && isset( $event['checkout'] ) && ! isset( $event['order'] ) ) ||
				self::validOrderEvent( $event ) );
	}

	private static function validOrderEvent( array $event ): bool {
		$order = $event['order'] ?? null;
		return ( $event['schemaVersion'] ?? null ) === 'woo.activity.v1' &&
			in_array( $event['eventType'] ?? null, array( 'ORDER_PLACED', 'ORDER_PAID', 'ORDER_CANCELLED' ), true ) &&
			CheckoutKey::valid( $event['eventId'] ?? null ) && CheckoutKey::valid( $event['checkoutKey'] ?? null ) &&
			is_string( $event['occurredAt'] ?? null ) &&
			! isset( $event['checkout'] ) && ! isset( $event['shopId'] ) &&
			is_array( $order ) && CheckoutKey::valid( $order['orderId'] ?? null ) &&
			( $order['checkoutKey'] ?? null ) === $event['checkoutKey'] &&
			is_string( $order['status'] ?? null ) &&
			1 === preg_match( '/^[a-z][a-z0-9_-]{0,63}$/D', $order['status'] );
	}

	private static function log( string $reason ): void {
		// No customer data, payload, credential or checkout URL in error logs.
		error_log( 'moda.woocommerce.checkout_activity.' . $reason );
	}
}
