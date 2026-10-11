<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

/** Strict hosted API-006 history boundary. Never forward provider/internal evidence. */
final class BillingPurchaseHistoryResponseValidator {
	private const ORDERS_URL = 'https://woocommerce.com/my-account/orders/';
	private const FILTERS = array( 'ACTIVE', 'WITHDRAWN', 'COMPLETED', 'REFUNDED', 'ALL' );
	private const PURCHASE_STATES = array( 'REQUESTED', 'ACTIVE', 'WITHDRAWN', 'COMPLETED', 'REFUNDED' );
	private const REFUND_STATES = array( 'REQUESTED', 'PROVIDER_ACTION_REQUIRED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'NEEDS_ATTENTION' );
	private const REASONS = array( 'REFUND_ALREADY_ATTEMPTED', 'NO_AVAILABLE_CREDITS', 'PROVIDER_EVIDENCE_UNAVAILABLE', 'REFUND_IN_PROGRESS' );

	public static function history( mixed $value ): bool {
		if ( ! self::keys( $value, array( 'schemaVersion', 'filter', 'page', 'pageSize', 'total', 'totalPages', 'purchases', 'refundRequest' ) ) ||
			1 !== $value['schemaVersion'] || ! in_array( $value['filter'], self::FILTERS, true ) ||
			! in_array( $value['pageSize'], array( 5, 10, 20 ), true ) || ! self::quantity( $value['total'] ) ||
			! self::quantity( $value['totalPages'] ) || $value['totalPages'] < 1 || ! self::quantity( $value['page'] ) ||
			$value['page'] < 1 || $value['page'] > $value['totalPages'] || ! is_array( $value['purchases'] ) ||
			! array_is_list( $value['purchases'] ) || count( $value['purchases'] ) > $value['pageSize'] ||
			! self::keys( $value['refundRequest'], array( 'method', 'url' ) ) ||
			'WOOCOMMERCE_ORDERS' !== $value['refundRequest']['method'] || self::ORDERS_URL !== $value['refundRequest']['url'] ) {
			return false;
		}
		foreach ( $value['purchases'] as $purchase ) {
			if ( ! self::purchase( $purchase ) ) return false;
		}
		return true;
	}

	private static function purchase( mixed $value ): bool {
		if ( ! self::keys( $value, array( 'id', 'status', 'createdAt', 'activatedAt', 'bundleLabel', 'planName', 'creditsGranted', 'currentAmount', 'reservedAmount', 'availableAmount', 'heldForRefundAmount', 'refundEligible', 'refundUnavailableReason', 'refundAttempted', 'latestRefund', 'completedRefund', 'originalProviderPurchase' ) ) ) return false;
		if ( ! self::text( $value['id'], 128 ) || ! in_array( $value['status'], self::PURCHASE_STATES, true ) ||
			! self::date( $value['createdAt'] ) || ! self::nullableDate( $value['activatedAt'] ) ||
			( null !== $value['bundleLabel'] && ( ! is_string( $value['bundleLabel'] ) || strlen( $value['bundleLabel'] ) > 120 ) ) ||
			! self::text( $value['planName'], 255 ) ) return false;
		foreach ( array( 'creditsGranted', 'currentAmount', 'reservedAmount', 'availableAmount', 'heldForRefundAmount' ) as $key ) {
			if ( ! self::quantity( $value[ $key ] ) ) return false;
		}
		return is_bool( $value['refundEligible'] ) && is_bool( $value['refundAttempted'] ) &&
			( null === $value['refundUnavailableReason'] || in_array( $value['refundUnavailableReason'], self::REASONS, true ) ) &&
			$value['refundEligible'] === ( null === $value['refundUnavailableReason'] ) &&
			( null === $value['latestRefund'] || self::refund( $value['latestRefund'] ) ) &&
			( null === $value['completedRefund'] || self::refund( $value['completedRefund'] ) ) &&
			( null === $value['originalProviderPurchase'] || self::money( $value['originalProviderPurchase'] ) );
	}

	private static function refund( mixed $value ): bool {
		return self::keys( $value, array( 'status', 'reason', 'finalCreditQuantity', 'providerAmount', 'createdAt', 'completedAt' ) ) &&
			in_array( $value['status'], self::REFUND_STATES, true ) &&
			( null === $value['reason'] || ( is_string( $value['reason'] ) && 1 === preg_match( '/^[A-Z][A-Z0-9_]{0,63}$/', $value['reason'] ) ) ) &&
			( null === $value['finalCreditQuantity'] || self::quantity( $value['finalCreditQuantity'] ) ) &&
			( null === $value['providerAmount'] || self::money( $value['providerAmount'] ) ) &&
			self::date( $value['createdAt'] ) && self::nullableDate( $value['completedAt'] );
	}

	private static function money( mixed $value ): bool {
		return self::keys( $value, array( 'amount', 'currency' ) ) &&
			is_string( $value['amount'] ) && 1 === preg_match( '/^\d{1,16}(?:\.\d{1,6})?$/', $value['amount'] ) &&
			is_string( $value['currency'] ) && 1 === preg_match( '/^[A-Z]{3}$/', $value['currency'] );
	}

	private static function date( mixed $value ): bool {
		return is_string( $value ) && strlen( $value ) <= 36 &&
			1 === preg_match( '/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/', $value ) &&
			false !== strtotime( $value );
	}

	private static function nullableDate( mixed $value ): bool { return null === $value || self::date( $value ); }
	private static function quantity( mixed $value ): bool { return is_int( $value ) && $value >= 0; }
	private static function text( mixed $value, int $max ): bool { return is_string( $value ) && trim( $value ) !== '' && strlen( $value ) <= $max; }
	private static function keys( mixed $value, array $expected ): bool {
		if ( ! is_array( $value ) ) return false;
		$keys = array_keys( $value );
		sort( $keys );
		sort( $expected );
		return $keys === $expected;
	}
}
