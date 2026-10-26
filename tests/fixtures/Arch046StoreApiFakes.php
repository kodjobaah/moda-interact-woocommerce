<?php

namespace Automattic\WooCommerce\StoreApi\Schemas\V1 {
	if ( ! class_exists( CartSchema::class ) ) {
		final class CartSchema { public const IDENTIFIER = 'cart'; }
	}
}

namespace {
	if ( ! defined( 'ARRAY_A' ) ) define( 'ARRAY_A', 'ARRAY_A' );
	if ( ! function_exists( 'woocommerce_store_api_register_update_callback' ) ) {
		function woocommerce_store_api_register_update_callback( array $definition ): void {
			$GLOBALS['arch046_store_api_update'] = $definition;
		}
	}
	if ( ! function_exists( 'woocommerce_store_api_register_endpoint_data' ) ) {
		function woocommerce_store_api_register_endpoint_data( array $definition ): void {
			$GLOBALS['arch046_store_api_schema'] = $definition;
		}
	}
}
