<?php

use ModaInteract\WooCommerce\Checkout\CheckoutCouponOutcomeHandler;
use PHPUnit\Framework\TestCase;

require_once dirname( __DIR__ ) . '/includes/Checkout/CheckoutDiagnosticLogger.php';
require_once dirname( __DIR__ ) . '/includes/Checkout/CheckoutCouponOutcomeHandler.php';

if ( ! function_exists( 'wc_get_logger' ) ) {
	function wc_get_logger() { return $GLOBALS['moda_interact_test_logger'] ?? new CheckoutCouponOutcomeTestLogger(); }
}

final class CheckoutCouponOutcomeTestLogger {
	public array $entries = array();
	public function error( string $message, array $context = array() ): void { $this->entries[] = array( $message, $context ); }
}

final class CheckoutCouponOutcomeHandlerTest extends TestCase {
	private mixed $prior_test_logger;
	private CheckoutCouponOutcomeTestLogger $logger;
	private CheckoutCouponOutcomeHandler $handler;

	protected function setUp(): void {
		$this->prior_test_logger = $GLOBALS['moda_interact_test_logger'] ?? null;
		$this->logger = new CheckoutCouponOutcomeTestLogger();
		$GLOBALS['moda_interact_test_logger'] = $this->logger;
		$this->handler = new CheckoutCouponOutcomeHandler();
	}

	protected function tearDown(): void {
		if ( null === $this->prior_test_logger ) unset( $GLOBALS['moda_interact_test_logger'] );
		else $GLOBALS['moda_interact_test_logger'] = $this->prior_test_logger;
		parent::tearDown();
	}

	public function test_records_bounded_mixed_outcome_without_coupon_values(): void {
		$outcome = $this->handler->handle( array(
			'appliedCodes' => array( 'GOOD10' ),
			'rejectedCodes' => array( 'SAVE10', 'EXPIRED20' ),
			'cartTotalRecalculated' => true,
		) );

		self::assertSame( 'rejected', $outcome );
		self::assertCount( 1, $this->logger->entries );
		[ $message, $context ] = $this->logger->entries[0];
		self::assertSame( 'coupon_restore_outcome', $context['reason'] );
		self::assertSame( 'outcome=rejected;applied_count=1;rejected_count=2;totals=recalculated', $context['error_message'] );
		$logged = $message . (string) json_encode( $context );
		self::assertStringNotContainsString( 'GOOD10', $logged );
		self::assertStringNotContainsString( 'SAVE10', $logged );
		self::assertStringNotContainsString( 'EXPIRED20', $logged );
	}

	public function test_maps_success_and_invalid_result_to_applied_and_unknown(): void {
		self::assertSame( 'applied', $this->handler->handle( array(
			'appliedCodes' => array( 'GOOD10' ), 'rejectedCodes' => array(), 'cartTotalRecalculated' => true,
		) ) );
		self::assertSame( 'unknown', $this->handler->handle( array(
			'appliedCodes' => array( 'SAVE10' ), 'rejectedCodes' => array(), 'cartTotalRecalculated' => false,
		) ) );
		self::assertSame( 'unknown', $this->handler->handle( false ) );
		self::assertCount( 3, $this->logger->entries );
		foreach ( $this->logger->entries as [ $message, $context ] ) {
			$logged = $message . (string) json_encode( $context );
			self::assertStringNotContainsString( 'GOOD10', $logged );
			self::assertStringNotContainsString( 'SAVE10', $logged );
		}
	}

	public function test_records_typed_outreach_outcome_without_coupon_values(): void {
		$this->handler->handle( array(
			'appliedCodes' => array(), 'rejectedCodes' => array(), 'cartTotalRecalculated' => true,
			'outreachOffer' => array( 'outcome' => 'CONFLICT_REQUIRES_CHOICE', 'recommendedCode' => 'SECRET15',
				'originalAppliedCodes' => array( 'SAVE10' ), 'currentAppliedCodes' => array( 'SAVE10' ),
				'rejectionReason' => 'GROUP_CONFLICT', 'totalsRecalculated' => true ),
		) );
		self::assertCount( 2, $this->logger->entries );
		[ $message, $context ] = $this->logger->entries[1];
		self::assertSame( 'outreach_offer_conflict_requires_choice', $context['reason'] );
		self::assertSame( 'outcome=CONFLICT_REQUIRES_CHOICE;original_count=1;current_count=1;reason=GROUP_CONFLICT', $context['error_message'] );
		self::assertStringNotContainsString( 'SECRET15', $message . (string) json_encode( $context ) );
		self::assertStringNotContainsString( 'SAVE10', $message . (string) json_encode( $context ) );
	}
}
