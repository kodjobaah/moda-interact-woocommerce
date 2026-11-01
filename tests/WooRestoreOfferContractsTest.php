<?php

use ModaInteract\WooCommerce\Api\WooRestoreOfferContracts;
use ModaInteract\WooCommerce\Api\WooRestoreResolveResponseValidator;
use PHPUnit\Framework\TestCase;

require_once dirname( __DIR__ ) . '/includes/Api/WooRestoreOfferContracts.php';
require_once dirname( __DIR__ ) . '/includes/Api/WooRestoreResolveResponseValidator.php';

final class WooRestoreOfferContractsTest extends TestCase {
	private array $examples;

	protected function setUp(): void {
		$this->examples = json_decode( file_get_contents( __DIR__ . '/fixtures/woo-restore-v1.json' ), true )['outreachOfferExamples'];
	}

	public function test_accepts_every_published_single_offer_branch_and_the_group_branch(): void {
		$offers = array_values( $this->examples );
		$offers[] = array( 'kind' => 'CHECKOUT_OFFERS', 'offers' => array(
			array( 'method' => 'CODE', 'code' => 'OFFER10', 'providerDiscountId' => 'woo:coupon:10' ),
			array( 'method' => 'AUTOMATIC', 'providerDiscountId' => 'woo:discount:22' ),
		) );
		foreach ( $offers as $offer ) self::assertTrue( WooRestoreOfferContracts::isValid( json_decode( wp_json_encode( $offer ) ) ) );
	}

	public function test_complete_v1_response_requires_a_strict_offer_union_and_keeps_snapshot_validation(): void {
		$fixture = json_decode( file_get_contents( __DIR__ . '/fixtures/woo-restore-v1.json' ), true );
		$response = $fixture['eligibleResolveResponse'];
		$response['outreachOffer'] = $this->examples['checkoutCode'];
		self::assertTrue( WooRestoreResolveResponseValidator::isValid( json_decode( wp_json_encode( $response ) ), 'recovery_456' ) );
		$response['outreachOffer'] = array( 'kind' => 'CHECKOUT_CODE', 'code' => 'SAVE10' );
		self::assertFalse( WooRestoreResolveResponseValidator::isValid( json_decode( wp_json_encode( $response ) ), 'recovery_456' ) );
		$response['outreachOffer'] = $this->examples['none'];
		$response['snapshot']['lines'][0]['metadata'] = 'unverified';
		self::assertFalse( WooRestoreResolveResponseValidator::isValid( json_decode( wp_json_encode( $response ) ), 'recovery_456' ) );
	}

	public function test_rejects_missing_extra_and_malformed_union_fields(): void {
		$invalid = array(
			array( 'kind' => 'NONE' ),
			array( 'kind' => 'NONE', 'reason' => 'NO_CONFIRMED_OFFER', 'extra' => true ),
			array( 'kind' => 'CHECKOUT_AUTOMATIC', 'providerDiscountId' => 'x', 'code' => 'SAVE10' ),
			array( 'kind' => 'CHECKOUT_OFFERS', 'offers' => array( array( 'method' => 'CODE', 'code' => 'SAVE10' ), array( 'method' => 'BOGUS' ) ) ),
			array( 'kind' => 'CHECKOUT_OFFERS', 'offers' => array( array( 'method' => 'CODE', 'code' => 'SAVE10', 'providerDiscountId' => 'id' ) ) ),
			array( 'kind' => 'ALTERNATIVE_PRODUCT', 'productId' => '101' ),
		);
		foreach ( $invalid as $offer ) self::assertFalse( WooRestoreOfferContracts::isValid( json_decode( wp_json_encode( $offer ) ) ) );
	}
}
