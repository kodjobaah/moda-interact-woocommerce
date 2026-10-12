<?php

use ModaInteract\WooCommerce\Rest\RecoveryCouponCatalogueController;
use PHPUnit\Framework\TestCase;

/** Minimal WordPress/WooCommerce object fixtures, deliberately not a live data store. */
if ( ! class_exists( 'WP_Query' ) ) {
	class WP_Query {
		public array $posts;
		public int $found_posts;
		public int $max_num_pages;

		public function __construct( array $args ) {
			$GLOBALS['moda_coupon_last_query'] = $args;
			$ids = array_filter( array_keys( $GLOBALS['moda_coupon_records'] ), static function ( int $id ) use ( $args ) {
				$code = $GLOBALS['moda_coupon_records'][ $id ]['code'];
				return '' === $args['s'] || false !== stripos( $code, $args['s'] );
			} );
			rsort( $ids, SORT_NUMERIC );
			$this->found_posts = count( $ids );
			$this->max_num_pages = (int) ceil( $this->found_posts / $args['posts_per_page'] );
			$this->posts = array_slice( $ids, ( $args['paged'] - 1 ) * $args['posts_per_page'], $args['posts_per_page'] );
		}
	}
}

if ( ! class_exists( 'WC_Coupon' ) ) {
	class WC_Coupon {
		private array $data;
		public function __construct( int $id ) { $this->data = $GLOBALS['moda_coupon_records'][ $id ] ?? array(); }
		public function get_id(): int { return $this->data['id'] ?? 0; }
		public function get_code(): string { return $this->data['code'] ?? ''; }
		public function get_discount_type(): string { return $this->data['type'] ?? 'percent'; }
		public function get_amount(): string { return $this->data['amount'] ?? '10'; }
		public function get_date_expires(): ?DateTimeImmutable { return isset( $this->data['expires'] ) ? new DateTimeImmutable( $this->data['expires'] ) : null; }
		public function get_usage_limit(): int { return $this->data['limit'] ?? 0; }
		public function get_usage_count(): int { return $this->data['count'] ?? 0; }
		public function get_email_restrictions(): array { return $this->data['emails'] ?? array(); }
		public function get_product_ids(): array { return $this->data['products'] ?? array(); }
		public function get_excluded_product_ids(): array { return array(); }
		public function get_product_categories(): array { return array(); }
		public function get_excluded_product_categories(): array { return array(); }
		public function get_individual_use(): bool { return false; }
		public function get_free_shipping(): bool { return false; }
		public function get_limit_usage_to_x_items(): int { return 0; }
		public function get_exclude_sale_items(): bool { return false; }
		public function get_minimum_amount(): string { return ''; }
		public function get_maximum_amount(): string { return ''; }
		public function get_usage_limit_per_user(): int { return 0; }
	}
}

if ( ! function_exists( 'wc_coupons_enabled' ) ) {
	function wc_coupons_enabled(): bool { return $GLOBALS['moda_coupon_enabled']; }
}
if ( ! function_exists( 'get_woocommerce_currency' ) ) {
	function get_woocommerce_currency(): string { return 'GBP'; }
}

final class RecoveryCouponCatalogueControllerTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_coupon_enabled'] = true;
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		$GLOBALS['moda_coupon_records'] = array();
		for ( $i = 1; $i <= 23; $i++ ) {
			$GLOBALS['moda_coupon_records'][ $i ] = array( 'id' => $i, 'code' => 'OFFER' . $i, 'type' => 'percent', 'amount' => '10' );
		}
	}

	public function test_is_capability_and_nonce_protected(): void {
		$controller = new RecoveryCouponCatalogueController();
		$controller->registerRoutes();
		$route = $GLOBALS['moda_interact_registered_rest_routes']['moda-interact/v1/merchant/recovery-coupons'];
		self::assertSame( 'GET', $route['methods'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		self::assertSame( 403, $controller->authorizeAdministrator( new WP_REST_Request() )->get_error_data()['status'] );
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_valid_rest_nonce'] = false;
		self::assertSame( 403, $controller->authorizeAdministrator( new WP_REST_Request() )->get_error_data()['status'] );
		$GLOBALS['moda_interact_valid_rest_nonce'] = true;
		self::assertTrue( $controller->authorizeAdministrator( new WP_REST_Request() ) );
	}

	public function test_search_and_server_side_pagination(): void {
		$controller = new RecoveryCouponCatalogueController();
		$page1 = $controller->handle( new WP_REST_Request( 'GET' ) );
		self::assertSame( 200, $page1->get_status() );
		self::assertSame( 23, $page1->get_data()['total'] );
		self::assertSame( 3, $page1->get_data()['totalPages'] );
		self::assertCount( 10, $page1->get_data()['items'] );
		self::assertSame( 23, $page1->get_data()['items'][0]['id'] );
		self::assertSame( 10, $GLOBALS['moda_coupon_last_query']['posts_per_page'] );
		self::assertSame( 'ids', $GLOBALS['moda_coupon_last_query']['fields'] );
		$page3 = $controller->handle( new WP_REST_Request( 'GET', array( 'page' => '3' ) ) );
		self::assertCount( 3, $page3->get_data()['items'] );
		$filtered = $controller->handle( new WP_REST_Request( 'GET', array( 'q' => 'OFFER2' ) ) );
		self::assertSame( 5, $filtered->get_data()['total'] );
		self::assertSame( 'REVIEW_REQUIRED', $filtered->get_data()['items'][0]['previewStatus'] );
		self::assertArrayNotHasKey( 'description', $filtered->get_data()['items'][0] );
		self::assertSame( 'private, no-store', $filtered->get_headers()['Cache-Control'] );
	}

	public function test_unsafe_queries_are_rejected_without_running_catalogue_query(): void {
		$controller = new RecoveryCouponCatalogueController();
		unset( $GLOBALS['moda_coupon_last_query'] );
		foreach ( array(
			array( 'shopId' => 'other' ),
			array( 'page' => '0' ),
			array( 'page' => '-1' ),
			array( 'page' => array( '1' ) ),
			array( 'q' => array( 'x' ) ),
			array( 'q' => "a\nsecret" ),
			array( 'q' => str_repeat( 'a', 81 ) ),
		) as $query ) {
			self::assertSame( 400, $controller->handle( new WP_REST_Request( 'GET', $query ) )->get_status() );
		}
		self::assertArrayNotHasKey( 'moda_coupon_last_query', $GLOBALS );
	}

	public function test_expired_usage_exhausted_restricted_and_unsupported_are_not_selectable(): void {
		$GLOBALS['moda_coupon_records'] = array(
			1 => array( 'id' => 1, 'code' => 'OLD', 'expires' => '2020-01-01' ),
			2 => array( 'id' => 2, 'code' => 'USED', 'limit' => 1, 'count' => 1 ),
			3 => array( 'id' => 3, 'code' => 'PERSONAL', 'emails' => array( 'someone@example.com' ) ),
			4 => array( 'id' => 4, 'code' => 'PRODUCT', 'type' => 'fixed_product' ),
			5 => array( 'id' => 5, 'code' => 'BASIC' ),
		);
		$items = ( new RecoveryCouponCatalogueController() )->handle( new WP_REST_Request( 'GET' ) )->get_data()['items'];
		self::assertSame( array( 'REVIEW_REQUIRED', 'UNSUPPORTED', 'RESTRICTED', 'EXHAUSTED', 'EXPIRED' ), array_column( $items, 'previewStatus' ) );
		$GLOBALS['moda_coupon_enabled'] = false;
		self::assertSame( array( 'status' => 'COUPONS_DISABLED' ), ( new RecoveryCouponCatalogueController() )->handle( new WP_REST_Request( 'GET' ) )->get_data() );
	}
}
