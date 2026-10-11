<?php

namespace ModaInteract\WooCommerce\Api;

defined( 'ABSPATH' ) || exit;

final class BillingResponseValidator {
	public static function isPresentation( array $value ): bool {
		return self::keys( $value, array( 'schemaVersion', 'experienceState', 'surfaces', 'currentPlan', 'pendingPlan', 'pendingCancellation', 'capacity', 'topUps' ) ) &&
			1 === $value['schemaVersion'] &&
			in_array( $value['experienceState'], array( 'ACTIVE', 'NO_CONTRACT', 'FROZEN', 'BILLING_ATTENTION' ), true ) &&
			self::surfaces( $value['surfaces'] ) &&
			self::nullableObject( $value['currentPlan'], array( self::class, 'currentPlan' ) ) &&
			self::nullableObject( $value['pendingPlan'], array( self::class, 'pendingPlan' ) ) &&
			self::nullableObject( $value['pendingCancellation'], array( self::class, 'pendingCancellation' ) ) &&
			self::capacity( $value['capacity'] ) &&
			self::topUps( $value['topUps'] );
	}

	public static function isPlanCatalogue( array $value ): bool {
		if ( ! self::keys( $value, array( 'schemaVersion', 'resolvedLocale', 'plans' ) ) || 1 !== $value['schemaVersion'] || ! self::text( $value['resolvedLocale'], 64 ) || ! is_array( $value['plans'] ) || ! array_is_list( $value['plans'] ) ) {
			return false;
		}
		foreach ( $value['plans'] as $plan ) {
			if ( ! is_array( $plan ) || ! self::plan( $plan ) ) {
				return false;
			}
		}
		return true;
	}

	public static function isConfirmation( array $value ): bool {
		return self::keys( $value, array( 'schemaVersion', 'operationId', 'kind', 'state', 'confirmationUrl' ) ) &&
			1 === $value['schemaVersion'] && self::text( $value['operationId'], 128 ) &&
			in_array( $value['kind'], array( 'SUBSCRIPTION_CREATE', 'PLAN_SWITCH' ), true ) &&
			in_array( $value['state'], array( 'AWAITING_CONFIRMATION', 'CONFIRMED' ), true ) &&
			self::confirmationUrl( $value['confirmationUrl'] );
	}

	public static function isCancellation( array $value ): bool {
		return self::keys( $value, array( 'schemaVersion', 'operationId', 'kind', 'state', 'confirmationUrl' ) ) &&
			1 === $value['schemaVersion'] && self::text( $value['operationId'], 128 ) &&
			'CANCEL' === $value['kind'] && 'CONFIRMED' === $value['state'] && null === $value['confirmationUrl'];
	}

	public static function isRecoveryCreditPurchase( array $value ): bool {
		return self::keys( $value, array( 'schemaVersion', 'purchaseId', 'operationId', 'state', 'confirmationUrl' ) ) &&
			1 === $value['schemaVersion'] && self::nonBlankText( $value['purchaseId'], 128 ) && self::nonBlankText( $value['operationId'], 128 ) &&
			'AWAITING_CONFIRMATION' === $value['state'] && self::confirmationUrl( $value['confirmationUrl'] );
	}

	public static function confirmationUrl( mixed $value ): bool {
		if ( ! is_string( $value ) || strlen( $value ) > 2048 ) {
			return false;
		}
		$parts = parse_url( $value );
		return is_array( $parts ) &&
			'https' === strtolower( (string) ( $parts['scheme'] ?? '' ) ) &&
			in_array( strtolower( (string) ( $parts['host'] ?? '' ) ), array( 'woocommerce.com', 'sandbox.woocommerce.com' ), true ) &&
			! isset( $parts['user'] ) && ! isset( $parts['pass'] ) &&
			! isset( $parts['fragment'] );
	}

	public static function keys( mixed $value, array $expected ): bool {
		if ( ! is_array( $value ) ) {
			return false;
		}
		$actual = array_keys( $value );
		sort( $actual );
		sort( $expected );
		return $actual === $expected;
	}

	private static function surfaces( mixed $value ): bool {
		return self::keys( $value, array( 'usageHistoryAllowed', 'purchaseHistoryAllowed', 'managePlansAllowed', 'cancelSubscriptionAllowed' ) ) &&
			is_bool( $value['usageHistoryAllowed'] ) && is_bool( $value['purchaseHistoryAllowed'] ) &&
			is_bool( $value['managePlansAllowed'] ) && is_bool( $value['cancelSubscriptionAllowed'] );
	}

	private static function currentPlan( mixed $value ): bool {
		return self::keys( $value, array( 'merchantPricingPlanId', 'displayName', 'planKind', 'recurringAmountMinor', 'currency', 'billingPeriod', 'currentPeriodEnd', 'cancelAtPeriodEnd', 'cancellationEffectiveAt' ) ) &&
			self::text( $value['merchantPricingPlanId'], 128 ) && self::text( $value['displayName'], 255 ) &&
			in_array( $value['planKind'], array( 'FREE', 'PAID_METERED' ), true ) && self::integer( $value['recurringAmountMinor'] ) &&
			self::currency( $value['currency'] ) && 'EVERY_30_DAYS' === $value['billingPeriod'] &&
			self::nullableDateTime( $value['currentPeriodEnd'] ) && is_bool( $value['cancelAtPeriodEnd'] ) &&
			self::nullableDateTime( $value['cancellationEffectiveAt'] );
	}

	private static function pendingPlan( mixed $value ): bool {
		return self::keys( $value, array( 'merchantPricingPlanId', 'displayName', 'recurringAmountMinor', 'currency', 'billingPeriod', 'state' ) ) &&
			self::text( $value['merchantPricingPlanId'], 128 ) && self::text( $value['displayName'], 255 ) &&
			self::integer( $value['recurringAmountMinor'] ) && self::currency( $value['currency'] ) &&
			'EVERY_30_DAYS' === $value['billingPeriod'] &&
			in_array( $value['state'], array( 'INITIATING', 'AWAITING_CONFIRMATION', 'OUTCOME_UNKNOWN' ), true );
	}

	private static function pendingCancellation( mixed $value ): bool {
		return self::keys( $value, array( 'state' ) ) &&
			in_array( $value['state'], array( 'INITIATING', 'AWAITING_CONFIRMATION', 'OUTCOME_UNKNOWN', 'CONFIRMED' ), true );
	}

	private static function capacity( mixed $value ): bool {
		return self::keys( $value, array( 'paidIncluded', 'freeLifetime', 'promotional', 'purchased' ) ) &&
			self::nullableObject( $value['paidIncluded'], array( self::class, 'paidIncluded' ) ) &&
			self::balance( $value['freeLifetime'] ) && self::balance( $value['promotional'] ) && self::purchased( $value['purchased'] );
	}

	private static function balance( mixed $value ): bool {
		return self::keys( $value, array( 'granted', 'committed', 'reserved', 'remaining' ) ) &&
			self::integer( $value['granted'] ) && self::integer( $value['committed'] ) && self::integer( $value['reserved'] ) && self::integer( $value['remaining'] );
	}

	private static function paidIncluded( mixed $value ): bool {
		return self::keys( $value, array( 'granted', 'currentAllowance', 'committed', 'reserved', 'forfeited', 'remaining' ) ) &&
			self::integer( $value['granted'] ) && self::integer( $value['currentAllowance'] ) && self::integer( $value['committed'] ) &&
			self::integer( $value['reserved'] ) && self::integer( $value['forfeited'] ) && self::integer( $value['remaining'] );
	}

	private static function purchased( mixed $value ): bool {
		return self::keys( $value, array( 'granted', 'committed', 'reserved', 'refunding', 'available' ) ) &&
			self::integer( $value['granted'] ) && self::integer( $value['committed'] ) && self::integer( $value['reserved'] ) &&
			self::integer( $value['refunding'] ) && self::integer( $value['available'] );
	}

	private static function topUps( mixed $value ): bool {
		if ( ! self::keys( $value, array( 'configured', 'purchaseEligible', 'offers', 'latestPurchase', 'unresolvedPurchases' ) ) || ! is_bool( $value['configured'] ) || ! is_bool( $value['purchaseEligible'] ) || ! is_array( $value['offers'] ) || ! array_is_list( $value['offers'] ) || ! self::nullableObject( $value['latestPurchase'], array( self::class, 'purchase' ) ) || ! is_array( $value['unresolvedPurchases'] ) || ! array_is_list( $value['unresolvedPurchases'] ) || count( $value['unresolvedPurchases'] ) > 100 ) {
			return false;
		}
		foreach ( $value['offers'] as $offer ) {
			if ( ! is_array( $offer ) || ! self::offer( $offer ) ) {
				return false;
			}
		}
		foreach ( $value['unresolvedPurchases'] as $purchase ) {
			if ( ! is_array( $purchase ) || ! self::purchase( $purchase ) ) {
				return false;
			}
		}
		return true;
	}

	private static function offer( mixed $value ): bool {
		return self::keys( $value, array( 'merchantPricingUsageEventId', 'label', 'creditsGranted', 'amountMinor', 'currency', 'purchaseEligible', 'unavailableReason' ) ) &&
			self::text( $value['merchantPricingUsageEventId'], 128 ) && self::text( $value['label'], 120 ) && self::integer( $value['creditsGranted'], 1 ) &&
			self::integer( $value['amountMinor'], 1 ) && 'USD' === $value['currency'] && is_bool( $value['purchaseEligible'] ) &&
			( null === $value['unavailableReason'] || 'PENDING_PURCHASE' === $value['unavailableReason'] );
	}

	private static function purchase( mixed $value ): bool {
		return self::keys( $value, array( 'id', 'status', 'merchantPricingUsageEventId', 'label', 'creditsGranted', 'currentAmount', 'reservedAmount', 'createdAt', 'activatedAt', 'operationState' ) ) &&
			self::text( $value['id'], 128 ) && in_array( $value['status'], array( 'REQUESTED', 'ACTIVE', 'COMPLETED', 'WITHDRAWN', 'REFUNDED' ), true ) &&
			self::text( $value['merchantPricingUsageEventId'], 128 ) && self::text( $value['label'], 120 ) && self::integer( $value['creditsGranted'] ) &&
			self::integer( $value['currentAmount'] ) && self::integer( $value['reservedAmount'] ) && self::dateTime( $value['createdAt'] ) &&
			self::nullableDateTime( $value['activatedAt'] ) && in_array( $value['operationState'], array( 'INITIATING', 'AWAITING_CONFIRMATION', 'OUTCOME_UNKNOWN', 'CONFIRMED', 'FAILED' ), true );
	}

	private static function plan( mixed $value ): bool {
		if ( ! self::keys( $value, array( 'merchantPricingPlanId', 'displayName', 'planKind', 'cataloguePosition', 'featured', 'localizedDescription', 'includedRecoveryCredits', 'allowancePeriod', 'billingPeriod', 'recurringAmountMinor', 'currency', 'highlights' ) ) || ! self::text( $value['merchantPricingPlanId'], 128 ) || ! self::text( $value['displayName'], 255 ) || ! in_array( $value['planKind'], array( 'FREE', 'PAID_METERED' ), true ) || ! self::integer( $value['cataloguePosition'] ) || ! is_bool( $value['featured'] ) || ! self::text( $value['localizedDescription'], 2000 ) || ! self::integer( $value['includedRecoveryCredits'] ) || ! in_array( $value['allowancePeriod'], array( 'LIFETIME', 'EVERY_30_DAYS' ), true ) || 'EVERY_30_DAYS' !== $value['billingPeriod'] || ! self::integer( $value['recurringAmountMinor'] ) || ! self::currency( $value['currency'] ) || ! is_array( $value['highlights'] ) || ! array_is_list( $value['highlights'] ) ) {
			return false;
		}
		foreach ( $value['highlights'] as $highlight ) {
			if ( ! self::keys( $highlight, array( 'contentKey', 'position', 'title', 'description' ) ) || ! self::text( $highlight['contentKey'], 128 ) || ! self::integer( $highlight['position'] ) || ! self::text( $highlight['title'], 120 ) || ! self::text( $highlight['description'], 2000 ) ) {
				return false;
			}
		}
		return true;
	}

	private static function nullableObject( mixed $value, callable $validator ): bool {
		return null === $value || ( is_array( $value ) && $validator( $value ) );
	}

	private static function text( mixed $value, int $maximum ): bool {
		return is_string( $value ) && '' !== $value && strlen( $value ) <= $maximum;
	}

	private static function nonBlankText( mixed $value, int $maximum ): bool {
		return is_string( $value ) && '' !== trim( $value ) && strlen( $value ) <= $maximum;
	}

	private static function integer( mixed $value, int $minimum = 0 ): bool {
		return is_int( $value ) && $value >= $minimum;
	}

	private static function currency( mixed $value ): bool {
		return is_string( $value ) && 1 === preg_match( '/^[A-Z]{3}$/', $value );
	}

	private static function nullableDateTime( mixed $value ): bool {
		return null === $value || self::dateTime( $value );
	}

	private static function dateTime( mixed $value ): bool {
		if ( ! is_string( $value ) || ! preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/', $value ) ) {
			return false;
		}
		$parsed = date_parse( $value );
		return 0 === $parsed['error_count'] && 0 === $parsed['warning_count'];
	}
}