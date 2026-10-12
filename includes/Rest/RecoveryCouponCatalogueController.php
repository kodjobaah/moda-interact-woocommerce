<?php

namespace ModaInteract\WooCommerce\Rest;

defined( 'ABSPATH' ) || exit;

/**
 * Read-only, bounded LOCAL Woo coupon catalogue for the Recovery Settings preview.
 * No selection is persisted and no coupon is considered eligible for a future checkout.
 */
final class RecoveryCouponCatalogueController {
	private const PAGE_SIZE = 10;

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'registerRoutes' ) );
	}

	public function registerRoutes(): void {
		register_rest_route( 'moda-interact/v1', '/merchant/recovery-coupons', array(
			'methods' => 'GET',
			'callback' => array( $this, 'handle' ),
			'permission_callback' => array( $this, 'authorizeAdministrator' ),
		) );
	}

	public function authorizeAdministrator( \WP_REST_Request $request ): bool|\WP_Error {
		return current_user_can( 'manage_woocommerce' ) &&
			(bool) wp_verify_nonce( (string) $request->get_header( 'X-WP-Nonce' ), 'wp_rest' )
			? true : new \WP_Error( 'rest_forbidden', 'Forbidden.', array( 'status' => 403 ) );
	}

	public function handle( \WP_REST_Request $request ): \WP_REST_Response {
		if ( 'GET' !== $request->get_method() || array() !== $request->get_body_params() || null !== $request->get_json_params() ) {
			return self::respond( array( 'status' => 'INVALID_REQUEST' ), 400 );
		}
		$params = $request->get_query_params();
		if ( array_diff( array_keys( $params ), array( 'q', 'page', '_locale' ) ) ||
			( isset( $params['_locale'] ) && 'user' !== $params['_locale'] ) ||
			( isset( $params['q'] ) && ( ! is_string( $params['q'] ) || strlen( $params['q'] ) > 80 || preg_match( '/[\x00-\x1f\x7f]/', $params['q'] ) ) ) ||
			( isset( $params['page'] ) && ( ! is_scalar( $params['page'] ) || ! preg_match( '/^[1-9]\d{0,3}$/', (string) $params['page'] ) ) ) ) {
			return self::respond( array( 'status' => 'INVALID_REQUEST' ), 400 );
		}
		if ( ! function_exists( 'wc_coupons_enabled' ) || ! class_exists( \WC_Coupon::class ) || ! class_exists( \WP_Query::class ) ) {
			return self::respond( array( 'status' => 'COUPONS_UNAVAILABLE' ), 503 );
		}
		if ( ! wc_coupons_enabled() ) {
			return self::respond( array( 'status' => 'COUPONS_DISABLED' ), 200 );
		}
		$page = isset( $params['page'] ) ? (int) $params['page'] : 1;
		$search = isset( $params['q'] ) ? trim( $params['q'] ) : '';
		try {
			// Woo coupon records are still held in WordPress's shop_coupon store;
			// WP_Query provides bounded server-side search and total-page counts.
			$query = new \WP_Query( array(
				'post_type' => 'shop_coupon',
				'post_status' => 'publish',
				'posts_per_page' => self::PAGE_SIZE,
				'paged' => $page,
				's' => $search,
				'fields' => 'ids',
				'orderby' => 'ID',
				'order' => 'DESC',
				'no_found_rows' => false,
			) );
			$items = array();
			foreach ( $query->posts as $id ) {
				$coupon = new \WC_Coupon( (int) $id );
				if ( (int) $coupon->get_id() !== (int) $id ||
				'' === $coupon->get_code() || strlen( (string) $coupon->get_code() ) > 256 ) continue;
				$items[] = self::describe( $coupon );
			}
			return self::respond( array(
				'schemaVersion' => 1,
				'page' => $page,
				'pageSize' => self::PAGE_SIZE,
				'total' => (int) $query->found_posts,
				'totalPages' => max( 1, (int) $query->max_num_pages ),
				'items' => $items,
			), 200 );
		} catch ( \Throwable $error ) {
			// Never disclose internal coupon data or WordPress query details.
			return self::respond( array( 'status' => 'COUPONS_UNAVAILABLE' ), 503 );
		}
	}

	private static function describe( \WC_Coupon $coupon ): array {
		$type = $coupon->get_discount_type();
		$expires = $coupon->get_date_expires();
		$usage_limit = (int) $coupon->get_usage_limit();
		$usage_count = (int) $coupon->get_usage_count();
		$status = 'REVIEW_REQUIRED';
		if ( ! in_array( $type, array( 'percent', 'fixed_cart' ), true ) ) {
			$status = 'UNSUPPORTED';
		} elseif ( $expires && $expires->getTimestamp() <= time() ) {
			$status = 'EXPIRED';
		} elseif ( $usage_limit > 0 && $usage_count >= $usage_limit ) {
			$status = 'EXHAUSTED';
		} elseif ( $coupon->get_email_restrictions() || $coupon->get_product_ids() ||
			$coupon->get_excluded_product_ids() || $coupon->get_product_categories() ||
			$coupon->get_excluded_product_categories() || $coupon->get_individual_use() ||
			$coupon->get_free_shipping() || $coupon->get_limit_usage_to_x_items() ||
			$coupon->get_exclude_sale_items() || $coupon->get_minimum_amount() ||
			$coupon->get_maximum_amount() || $coupon->get_usage_limit_per_user() ) {
			$status = 'RESTRICTED';
		}
		return array(
			'id' => (int) $coupon->get_id(),
			'code' => (string) $coupon->get_code(),
			'type' => in_array( $type, array( 'percent', 'fixed_cart', 'fixed_product' ), true ) ? $type : 'other',
			'amount' => (string) $coupon->get_amount(),
			'currency' => get_woocommerce_currency(),
			'previewStatus' => $status,
		);
	}

	private static function respond( array $data, int $status ): \WP_REST_Response {
		$response = new \WP_REST_Response( $data, $status );
		$response->header( 'Cache-Control', 'private, no-store' );
		$response->header( 'Pragma', 'no-cache' );
		return $response;
	}
}
