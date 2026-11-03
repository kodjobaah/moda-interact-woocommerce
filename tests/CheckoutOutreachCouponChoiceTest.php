<?php

use ModaInteract\WooCommerce\Checkout\CheckoutKey;
use ModaInteract\WooCommerce\Checkout\CheckoutOutreachCouponChoice;
use ModaInteract\WooCommerce\Checkout\CheckoutOutreachOfferChoicePresenter;
use PHPUnit\Framework\TestCase;

if ( ! function_exists( 'WC' ) ) { function WC() { return $GLOBALS['arch035_wc'] ?? null; } }
if ( ! function_exists( 'wc_format_coupon_code' ) ) { function wc_format_coupon_code( string $code ): string { return strtolower( trim( $code ) ); } }
if ( ! function_exists( 'wc_get_checkout_url' ) ) { function wc_get_checkout_url() { return $GLOBALS['moda_interact_test_checkout_url'] ?? 'https://merchant.example/shop/checkout'; } }
if ( ! function_exists( 'wc_get_logger' ) ) {
	function wc_get_logger() {
		return $GLOBALS['moda_interact_test_logger'] ?? new class {
			public function error( string $message, array $context = array() ): void {}
		};
	}
}
require_once __DIR__ . '/fixtures/WooBlocksIntegrationInterface.php';

final class OutreachChoiceSession {
	public array $values = array();
	public function get( string $key ): mixed { return $this->values[ $key ] ?? null; }
	public function set( string $key, mixed $value ): void { $this->values[ $key ] = $value; }
	public function save_data(): void {}
}

final class OutreachChoiceCart {
	public array $coupons = array( 'SAVE10' );
	public string $hash = 'cart-hash-1';
	public bool $reject_offered = false;
	public bool $sparse = false;
	public bool $throw_on_hash = false;
	public bool $throw_on_coupons = false;
	public function get_cart_hash(): string {
		if ( $this->throw_on_hash ) throw new RuntimeException( 'cart hash read failed for customer shopper@example.invalid' );
		return $this->hash;
	}
	public function get_applied_coupons(): array {
		if ( $this->throw_on_coupons ) throw new RuntimeException( 'coupon list provider read failed for customer shopper@example.invalid' );
		if ( ! $this->sparse ) return $this->coupons;
		$sparse = array();
		foreach ( $this->coupons as $index => $code ) $sparse[ $index + 1 ] = $code;
		return $sparse;
	}
	public function remove_coupon( string $code ): void { $this->coupons = array_values( array_filter( $this->coupons, static fn( $value ) => strtolower( $value ) !== strtolower( $code ) ) ); }
	public function apply_coupon( string $code ): bool {
		if ( $this->reject_offered && 'OFFER15' === $code ) {
			$GLOBALS['moda_interact_test_wc_notices']['error'][] = array( 'notice' => 'OFFER15 rejected' );
			return false;
		}
		$this->coupons[] = $code;
		return true;
	}
	public function calculate_totals(): void {}
}

final class OutreachChoiceIntegrationRegistry {
	public mixed $integration = null;
	public function register( mixed $integration ): void { $this->integration = $integration; }
}

final class CheckoutOutreachCouponChoiceTest extends TestCase {
	private CheckoutOutreachCouponChoice $choice;
	private OutreachChoiceSession $session;
	private OutreachChoiceCart $cart;
	private mixed $prior_logger;
	private mixed $prior_home;
	private mixed $prior_checkout_url;

	protected function setUp(): void {
		$this->prior_logger = $GLOBALS['moda_interact_test_logger'] ?? null;
		$GLOBALS['moda_interact_test_logger'] = new class {
			public array $entries = array();
			public function error( string $message, array $context = array() ): void { $this->entries[] = array( $message, $context ); }
		};
		$this->prior_home = $GLOBALS['moda_interact_home_url'] ?? null;
		$GLOBALS['moda_interact_home_url'] = 'https://merchant.example';
		$this->prior_checkout_url = $GLOBALS['moda_interact_test_checkout_url'] ?? null;
		$GLOBALS['moda_interact_test_checkout_url'] = 'https://merchant.example/checkout';
		$GLOBALS['moda_interact_test_wc_notices'] = array( 'notice' => array( 'merchant notice' ) );
		unset( $GLOBALS['moda_interact_nonces'][ 'moda_interact_outreach_coupon_choice_v1' ] );
		$this->session = new OutreachChoiceSession();
		$this->cart = new OutreachChoiceCart();
		$GLOBALS['arch035_wc'] = (object) array( 'session' => $this->session, 'cart' => $this->cart );
		$this->session->values = array(
			CheckoutKey::SESSION_FIELD => 'woo-checkout-1',
			'moda_interact_restore_completed_v1' => array( 'recoveryId' => 'recovery-1', 'completedAt' => time() ),
		);
		$this->choice = new CheckoutOutreachCouponChoice();
	}

	protected function tearDown(): void {
		if ( null === $this->prior_logger ) unset( $GLOBALS['moda_interact_test_logger'] );
		else $GLOBALS['moda_interact_test_logger'] = $this->prior_logger;
		if ( null === $this->prior_home ) unset( $GLOBALS['moda_interact_home_url'] );
		else $GLOBALS['moda_interact_home_url'] = $this->prior_home;
		if ( null === $this->prior_checkout_url ) unset( $GLOBALS['moda_interact_test_checkout_url'] );
		else $GLOBALS['moda_interact_test_checkout_url'] = $this->prior_checkout_url;
		unset( $GLOBALS['moda_interact_nonces']['moda_interact_outreach_coupon_choice_v1'] );
		parent::tearDown();
	}

	public function test_records_only_verified_conflict_and_exposes_only_nonce_and_availability(): void {
		$this->choice->record( $this->choiceResult(), 'recovery-1', 'woo-checkout-1' );
		$state = $this->choice->publicState();
		self::assertSame( array( 'available', 'nonce' ), array_keys( $state ) );
		self::assertTrue( $state['available'] );
		self::assertSame( array( 'recoveryId', 'codes', 'originalCodes', 'cartHash', 'checkoutKey', 'createdAt', 'nonceBinding', 'nonce' ), array_keys( $this->session->get( CheckoutOutreachCouponChoice::SESSION_FIELD ) ) );
		self::assertArrayNotHasKey( 'codes', $state );
		$this->choice->record( array_merge( $this->choiceResult(), array( 'choiceAvailable' => false ) ), 'recovery-1', 'woo-checkout-1' );
		self::assertNull( $this->choice->publicState() );
	}

	public function test_successful_post_switches_codes_and_double_submit_is_a_noop(): void {
		$this->choice->record( $this->choiceResult(), 'recovery-1', 'woo-checkout-1' );
		$response = $this->choice->handleRequest( 'POST', $this->post(), $this->server() );
		self::assertSame( 'https://merchant.example/checkout', $response['redirect'] );
		self::assertSame( array( 'OFFER15' ), $this->cart->coupons );
		self::assertSame( array( 'notice' => array( 'merchant notice' ) ), $GLOBALS['moda_interact_test_wc_notices'] );
		self::assertNull( $this->session->get( CheckoutOutreachCouponChoice::SESSION_FIELD ) );
		$this->choice->handleRequest( 'POST', $this->post(), $this->server() );
		self::assertSame( array( 'OFFER15' ), $this->cart->coupons );
	}

	public function test_cart_change_expires_choice_without_mutating_codes(): void {
		$this->choice->record( $this->choiceResult(), 'recovery-1', 'woo-checkout-1' );
		$this->cart->hash = 'changed-cart';
		$this->choice->handleRequest( 'POST', $this->post(), $this->server() );
		self::assertSame( array( 'SAVE10' ), $this->cart->coupons );
		self::assertNull( $this->session->get( CheckoutOutreachCouponChoice::SESSION_FIELD ) );
	}

	public function test_old_form_nonce_cannot_switch_the_offer_for_a_later_recovery(): void {
		$this->choice->record( $this->choiceResult(), 'recovery-1', 'woo-checkout-1' );
		$old_post = $this->post();
		$old_nonce = $old_post['_wpnonce'];
		$this->session->values['moda_interact_restore_completed_v1'] = array( 'recoveryId' => 'recovery-2', 'completedAt' => time() );
		$this->choice->record( array_merge( $this->choiceResult(), array( 'recommendedCodes' => array( 'OFFER20' ) ) ), 'recovery-2', 'woo-checkout-1' );
		$new_state = $this->session->get( CheckoutOutreachCouponChoice::SESSION_FIELD );
		self::assertNotSame( $old_nonce, $new_state['nonce'], 'Each choice receives a different nonce action binding.' );
		self::assertSame( array( 'SAVE10' ), $this->cart->coupons );
		$this->choice->handleRequest( 'POST', $old_post, $this->server() );
		self::assertSame( array( 'SAVE10' ), $this->cart->coupons, 'A superseded form cannot apply the new recovery offer.' );
		self::assertNotNull( $this->session->get( CheckoutOutreachCouponChoice::SESSION_FIELD ), 'An old form must not invalidate the current recovery choice.' );
		$this->choice->handleRequest( 'POST', $this->post(), $this->server() );
		self::assertSame( array( 'OFFER20' ), $this->cart->coupons, 'The current recovery form remains usable.' );
	}

	public function test_cart_read_exception_during_render_is_contained_and_logged(): void {
		$this->choice->record( $this->choiceResult(), 'recovery-1', 'woo-checkout-1' );
		$this->cart->throw_on_hash = true;
		self::assertNull( $this->choice->publicState() );
		self::assertNull( $this->session->get( CheckoutOutreachCouponChoice::SESSION_FIELD ) );
		$entry = end( $GLOBALS['moda_interact_test_logger']->entries );
		self::assertSame( 'choice_state_render_failed', $entry[1]['reason'] );
		self::assertStringNotContainsString( 'shopper@example.invalid', $entry[1]['error_message'] );
	}

	public function test_cart_read_exception_during_post_is_contained_without_mutation(): void {
		$this->choice->record( $this->choiceResult(), 'recovery-1', 'woo-checkout-1' );
		$this->cart->throw_on_hash = true;
		$response = $this->choice->handleRequest( 'POST', $this->post(), $this->server() );
		self::assertSame( 'https://merchant.example/checkout', $response['redirect'] );
		self::assertSame( array( 'SAVE10' ), $this->cart->coupons );
		self::assertNull( $this->session->get( CheckoutOutreachCouponChoice::SESSION_FIELD ) );
		$entry = end( $GLOBALS['moda_interact_test_logger']->entries );
		self::assertSame( 'choice_request_boundary_failed', $entry[1]['reason'] );
		self::assertStringNotContainsString( 'shopper@example.invalid', $entry[1]['error_message'] );
	}

	public function test_sparse_live_coupon_indexes_do_not_invalidate_the_session_choice(): void {
		$this->cart->sparse = true;
		$this->choice->record( $this->choiceResult(), 'recovery-1', 'woo-checkout-1' );
		$this->choice->handleRequest( 'POST', $this->post(), $this->server() );
		self::assertSame( array( 'OFFER15' ), $this->cart->coupons );
	}

	public function test_rejected_offer_restores_originals_and_contains_attempt_notice(): void {
		$this->choice->record( $this->choiceResult(), 'recovery-1', 'woo-checkout-1' );
		$this->cart->reject_offered = true;
		$this->choice->handleRequest( 'POST', $this->post(), $this->server() );
		self::assertSame( array( 'SAVE10' ), $this->cart->coupons );
		self::assertSame( array( 'notice' => array( 'merchant notice' ) ), $GLOBALS['moda_interact_test_wc_notices'] );
	}

	public function test_query_like_or_cross_origin_submissions_cannot_consume_choice(): void {
		$this->choice->record( $this->choiceResult(), 'recovery-1', 'woo-checkout-1' );
		self::assertNull( $this->choice->handleRequest( 'GET', $this->post(), $this->server() ) );
		self::assertNotNull( $this->choice->publicState(), 'Scanner GET does not consume a choice.' );
		$server = $this->server();
		$server['HTTP_ORIGIN'] = 'https://attacker.example';
		$this->choice->handleRequest( 'POST', $this->post(), $server );
		self::assertSame( array( 'SAVE10' ), $this->cart->coupons );
		self::assertNull( $this->session->get( CheckoutOutreachCouponChoice::SESSION_FIELD ) );
	}

	public function test_classic_and_blocks_presenters_render_only_action_and_nonce(): void {
		$this->choice->record( $this->choiceResult(), 'recovery-1', 'woo-checkout-1' );
		$presenter = new CheckoutOutreachOfferChoicePresenter( $this->choice );
		ob_start();
		$presenter->renderClassic();
		$html = ob_get_clean();
		self::assertSame( 2, substr_count( $html, '<input type="hidden"' ) );
		self::assertStringContainsString( 'name="moda_interact_outreach_coupon_choice" value="try_offered"', $html );
		$nonce = $this->session->get( CheckoutOutreachCouponChoice::SESSION_FIELD )['nonce'];
		self::assertStringContainsString( 'name="_wpnonce" value="' . $nonce . '"', $html );
		self::assertStringNotContainsString( 'OFFER15', $html );
		$registry = new OutreachChoiceIntegrationRegistry();
		$presenter->registerBlocksIntegration( $registry );
		$data = $registry->integration->get_script_data();
		self::assertTrue( $data['available'] );
		self::assertSame( $nonce, $data['nonce'] );
		self::assertArrayNotHasKey( 'codes', $data );
		self::assertArrayNotHasKey( 'recoveryId', $data );
	}

	private function choiceResult(): array {
		return array( 'outcome' => 'CONFLICT_REQUIRES_CHOICE', 'recommendedCodes' => array( 'OFFER15' ),
			'choiceAvailable' => true, 'originalAppliedCodes' => array( 'SAVE10' ), 'currentAppliedCodes' => array( 'SAVE10' ),
			'rejectionReason' => 'ORIGINAL_COUPON_CONFLICT', 'totalsRecalculated' => true );
	}

	private function post(): array {
		$state = $this->session->get( CheckoutOutreachCouponChoice::SESSION_FIELD );
		return array( CheckoutOutreachCouponChoice::ACTION_FIELD => 'try_offered', '_wpnonce' => $state['nonce'] ?? '' );
	}

	private function server(): array {
		return array( 'REQUEST_URI' => (string) parse_url( wc_get_checkout_url(), PHP_URL_PATH ), 'CONTENT_LENGTH' => '128', 'HTTP_ORIGIN' => 'https://merchant.example' );
	}
}
