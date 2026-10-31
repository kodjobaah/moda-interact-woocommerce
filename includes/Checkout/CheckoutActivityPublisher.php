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
		private readonly ?SiteIdentity $site_identity = null,
		private readonly ?\Closure $retry_scheduler = null
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
		// API-001 keeps phone proof inside the canonical authenticated v1 envelope.
		$contact = $event['checkout']['contact'] ?? null;
		if ( is_array( $contact ) ) {
			unset( $contact['canonicalPhone'], $contact['verifiedCountryCode'] );
		}
		if ( is_array( $contact ) && isset( $contact['phone'] ) ) {
			$country = null;
			$customer = function_exists( 'WC' ) ? ( WC()->customer ?? null ) : null;
			if ( is_object( $customer ) && method_exists( $customer, 'get_billing_country' ) ) {
				$country = CheckoutConsentPhone::verifiedCountry( $customer->get_billing_country() );
			}
			$canonical = CheckoutConsentPhone::normalize( $contact['phone'], $country );
			if ( null !== $canonical ) {
				$contact['canonicalPhone'] = $canonical;
				if ( null !== $country ) $contact['verifiedCountryCode'] = $country;
			} else {
				unset( $contact['phone'] );
			}
			if ( $contact ) $event['checkout']['contact'] = $contact;
			else unset( $event['checkout']['contact'] );
		} elseif ( is_array( $contact ) ) {
			if ( $contact ) $event['checkout']['contact'] = $contact;
			else unset( $event['checkout']['contact'] );
		}
		return $this->queue( $event );
	}

	/** Order events use the same Action Scheduler hook, installation check and retry path. */
	public function enqueueOrder( array $event ): bool {
		if ( ! self::validOrderEvent( $event ) ) return false;
		return $this->queue( $event );
	}

	/**
	 * Explicit operator replay of a FAILED Action Scheduler order delivery by ID.
	 * Never accept caller-supplied replacement payloads or replay other hooks.
	 * The original eventId/occurredAt survive; only the retry budget resets.
	 */
	public function replayFailedOrder( int $action_id ): bool {
		if ( $action_id < 1 || ! class_exists( 'ActionScheduler' ) ) return false;
		try {
			$store = \ActionScheduler::store();
			if ( 'failed' !== $store->get_status( $action_id ) ) return false;
			$action = $store->fetch_action( $action_id );
			if ( ! is_object( $action ) || $action->get_hook() !== self::ACTION || $action->get_group() !== self::GROUP ) return false;
			$args = $action->get_args();
			if ( ! is_array( $args ) || ! is_array( $args['event'] ?? null ) ||
				! self::validOrderEvent( $args['event'] ) || ! is_string( $args['installationId'] ?? null ) ||
				! is_string( $args['shopId'] ?? null ) || ! is_int( $args['attempt'] ?? null ) ||
				$args['attempt'] < 1 || $args['attempt'] > self::MAX_ATTEMPTS ) return false;
			$current = ( $this->installations ?? new InstallationStore() )->read();
			if ( 'valid' !== $current['state'] || $current['record']['installationId'] !== $args['installationId'] ||
				$current['record']['shopId'] !== $args['shopId'] ) {
				self::log( 'replay_installation_changed' );
				return false;
			}
			$identity = $this->site_identity ?? new SiteIdentity( ModaApiConfiguration::serverMode() );
			if ( $identity->currentCanonicalUrl() !== $current['record']['canonicalSiteUrl'] ) {
				self::log( 'replay_site_identity_changed' );
				return false;
			}
			return $this->queue( $args['event'] );
		} catch ( \Throwable $error ) {
			self::log( 'replay_unavailable', $error );
			return false;
		}
	}

	private function queue( array $event ): bool {
		if ( ! function_exists( 'as_enqueue_async_action' ) ) {
			self::log( 'scheduler_unavailable' );
			return false;
		}
		$installed = ( $this->installations ?? new InstallationStore() )->read();
		if ( 'valid' !== $installed['state'] ) {
			self::log( 'installation_unavailable' );
			return false;
		}
		$record = $installed['record'];
		$json = wp_json_encode( $event );
		if ( ! is_string( $json ) ) {
			self::log( 'event_encoding_failed' );
			return false;
		}
		if ( strlen( $json ) > 65536 ) {
			self::log( 'event_size_limit_exceeded' );
			return false;
		}
		try {
			$id = as_enqueue_async_action( self::ACTION,
				array( 'event' => $event, 'installationId' => $record['installationId'], 'shopId' => $record['shopId'], 'attempt' => 1 ), self::GROUP, true );
			if ( is_numeric( $id ) && (int) $id > 0 ) return true;
			self::log( 'enqueue_rejected' );
			return false;
		} catch ( \Throwable $error ) {
			self::log( 'enqueue_failed', $error );
			return false;
		}
	}

	/** Each action retries the *identical* bounded event with its original eventId. */
	public function deliver( array $event, string $installation_id, string $shop_id, int $attempt ): void {
		if ( $attempt < 1 || $attempt > self::MAX_ATTEMPTS || ! self::validActivityEvent( $event ) ) {
			self::terminalFailure( $event, $attempt, 'invalid_action' );
			return;
		}
		$current = ( $this->installations ?? new InstallationStore() )->read();
		if ( 'valid' !== $current['state'] || $current['record']['shopId'] !== $shop_id ||
			$current['record']['installationId'] !== $installation_id ) {
			self::terminalFailure( $event, $attempt, 'installation_changed' );
			return;
		}
		$site_valid = false;
		try {
			$identity = $this->site_identity ?? new SiteIdentity( ModaApiConfiguration::serverMode() );
			$site_valid = $identity->currentCanonicalUrl() === $current['record']['canonicalSiteUrl'];
		} catch ( \Throwable $error ) {
			self::log( 'site_identity_unavailable', $error );
			self::terminalFailure( $event, $attempt, 'site_identity_unavailable' );
			return;
		}
		if ( ! $site_valid ) {
			self::terminalFailure( $event, $attempt, 'site_identity_changed' );
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
			self::log( 'delivery_exception', $error );
			if ( $error instanceof ModaApiClientException && $error->http_status !== null &&
				$error->http_status >= 400 && $error->http_status < 500 && ! in_array( $error->http_status, array( 408, 429 ), true ) ) {
				self::terminalFailure( $event, $attempt, 'rejected' );
				return;
			}
		}
		if ( $attempt >= self::MAX_ATTEMPTS || ( null === $this->retry_scheduler && ! function_exists( 'as_schedule_single_action' ) ) ) {
			self::terminalFailure( $event, $attempt, 'retry_exhausted' );
			return;
		}
		$scheduled = false;
		try {
			$delay = array( 1 => 60, 2 => 300, 3 => 900 )[ $attempt ];
			$args = array( 'event' => $event, 'installationId' => $installation_id, 'shopId' => $shop_id, 'attempt' => $attempt + 1 );
			$id = $this->retry_scheduler
				? ( $this->retry_scheduler )( time() + $delay, self::ACTION, $args, self::GROUP, true )
				: as_schedule_single_action( time() + $delay, self::ACTION, $args, self::GROUP, true );
			$scheduled = is_numeric( $id ) && (int) $id > 0;
		} catch ( \Throwable $error ) {
			self::log( 'retry_schedule_failed', $error );
		}
		if ( ! $scheduled ) self::terminalFailure( $event, $attempt, 'retry_schedule_failed' );
	}

	/**
	 * Action Scheduler marks a throwing action FAILED and retains its original
	 * arguments for deliberate replay. Checkout actions retain legacy log-only
	 * behaviour; only known order terminal/placement activity is hardened here.
	 */
	private static function terminalFailure( array $event, int $attempt, string $reason ): void {
		$event_id = $event['eventId'] ?? null;
		$safe_id = is_string( $event_id ) && preg_match( '/^woo-[0-9a-f]{32}$/D', $event_id ) ? $event_id : 'unavailable';
		$diagnostic = 'delivery_failed reason=' . $reason . ' eventId=' . $safe_id . ' attempt=' . $attempt;
		self::log( $diagnostic );
		if ( in_array( $event['eventType'] ?? null, array( 'ORDER_PLACED', 'ORDER_PAID', 'ORDER_CANCELLED' ), true ) ) {
			throw new \RuntimeException( 'moda.woocommerce.checkout_activity.' . $diagnostic );
		}
	}

	private static function validActivityEvent( array $event ): bool {
		return ( $event['schemaVersion'] ?? null ) === 'woo.activity.v1' &&
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

	private static function log( string $reason, ?\Throwable $error = null ): void {
		CheckoutDiagnosticLogger::record( 'checkout_activity', $reason, $error );
	}
}
