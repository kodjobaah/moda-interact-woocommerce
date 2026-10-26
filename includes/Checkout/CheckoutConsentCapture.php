<?php

namespace ModaInteract\WooCommerce\Checkout;

defined( 'ABSPATH' ) || exit;

/**
 * Checkout-origin server observation. Neither a phone lookup nor a checkbox
 * rendered in a browser is consent. Hooks only run after Woo security checks;
 * this class independently validates their nonce/session and observes a change.
 */
final class CheckoutConsentCapture {
	private const SESSION_FIELD = 'moda_interact_checkout_consent_observation_v2';
	private const BLOCKS_STAGE = 'moda_interact_checkout_blocks_waiting_for_phone_v2';
	private const MAX_STORE_CHOICE_RECEIPTS = 32;

	private readonly CheckoutConsentProof $proof;
	private readonly CheckoutConsentStatusReader $status;
	/** Request-local, fixed-code diagnostic. Never contains shopper data. */
	private string $lastFailureReason = 'capture_not_invoked';

	public function failureReason(): string {
		return $this->lastFailureReason;
	}

	private function rejected( string $reason ): bool {
		$this->lastFailureReason = $reason;
		return false;
	}

	private function accepted(): bool {
		$this->lastFailureReason = '';
		return true;
	}

	/**
	 * Only an explicit, validated Store API choice carries this request ID.
	 * Remember a bounded history per Moda checkout so transport retries do not
	 * create another grant, including when an old GRANT is replayed after REVOKE.
	 * NEVER evict an ID while the checkout is active: reject new actions at the
	 * cap instead, so a previously seen ID cannot become a new GRANT.
	 * Never store or expose the ID in hosted consent evidence or browser status.
	 */
	private function rememberStoreChoice( array &$state, ?string $request_id, bool $checked ): void {
		if ( null === $request_id ) return;
		$receipts = is_array( $state['storeChoiceReceipts'] ?? null )
			? $state['storeChoiceReceipts'] : array();
		$digest = hash( 'sha256', $request_id );
		unset( $receipts[ $digest ] );
		$receipts[ $digest ] = $checked ? 'GRANT' : 'REVOKE';
		$state['storeChoiceReceipts'] = $receipts;
	}

	/** Only the same acknowledged action in the same state is idempotent. */
	private function replayedStoreChoice( array $state, ?string $request_id, bool $checked ): ?bool {
		if ( null === $request_id ) return null;
		$receipts = $state['storeChoiceReceipts'] ?? null;
		$digest = hash( 'sha256', $request_id );
		if ( ! is_array( $receipts ) || ! isset( $receipts[ $digest ] ) ) return null;
		if ( $receipts[ $digest ] !== ( $checked ? 'GRANT' : 'REVOKE' ) ) {
			return $this->rejected( 'capture_observe_store_choice_id_conflict' );
		}
		if ( is_array( $state['pending'] ?? null ) || (bool) $state['checked'] !== $checked ) {
			return $this->rejected( 'capture_observe_store_choice_stale_replay' );
		}
		return $this->accepted();
	}


	public function __construct(
		private readonly CheckoutConsentPublisher $publisher,
		private readonly ?CheckoutConsentEligibility $eligibility = null,
		?CheckoutConsentProof $proof = null,
		?CheckoutConsentStatusReader $status = null
	) {
		$this->proof = $proof ?? new CheckoutConsentProof();
		$this->status = $status ?? new CheckoutConsentStatusReader();
	}

	public function register(): void {
		$this->publisher->register();
		// Runs before capture's priority 10. Capture remains independent and
		// never infers consent from the checkout activity payload.
		add_action( 'woocommerce_checkout_update_order_review', array( $this, 'classicReview' ), 5, 1 );
		add_action( 'woocommerce_store_api_checkout_update_draft', array( $this, 'blocksDraft' ), 5, 1 );
		// An existing Woo draft order takes a different PUT path than a fresh session.
		add_action( 'woocommerce_store_api_checkout_update_order_from_request', array( $this, 'blocksOrderDraft' ), 5, 2 );
		add_action( 'woocommerce_store_api_checkout_update_customer_from_request', array( $this, 'blocksCustomer' ), 5, 2 );
		add_action( 'woocommerce_store_api_cart_update_customer_from_request', array( $this, 'blocksBillingUpdated' ), 5, 2 );
		add_action( 'woocommerce_checkout_order_processed', array( $this, 'endCheckout' ), 20, 1 );
		add_action( 'woocommerce_store_api_checkout_order_processed', array( $this, 'endCheckout' ), 20, 1 );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueueClassicChange' ) );
		add_action( 'wp_logout', array( $this, 'invalidatePendingSession' ) );
		add_action( 'wp_login', array( $this, 'invalidatePendingSession' ) );
	}

	public function enqueueClassicChange(): void {
		if ( ! function_exists( 'is_checkout' ) || ! is_checkout() ||
			( function_exists( 'is_order_received_page' ) && is_order_received_page() ) ) return;
		// Only a classic checkout uses this script; Blocks uses the official PUT draft hook.
		if ( function_exists( 'has_block' ) && has_block( 'woocommerce/checkout' ) ) return;
		if ( ! ( $this->eligibility ?? new CheckoutConsentEligibility() )->eligible() ) return;
		wp_enqueue_script( 'moda-woo-consent-classic',
			plugins_url( 'assets/js/checkout-consent-classic.js', MODA_INTERACT_MAIN_PLUGIN_FILE ),
			array( 'jquery' ), '1.0.0', true );
	}

	public function classicReview( mixed $posted ): void {
		// Woo's update_order_review action fires after check_ajax_referer; reject
		// direct hook calls and forged requests instead of trusting an assertion.
		$nonce = $_POST['security'] ?? null;
		if ( ! is_string( $nonce ) || ! function_exists( 'wp_verify_nonce' ) ||
			! wp_verify_nonce( $nonce, 'update-order-review' ) ) return;
		if ( ! is_string( $posted ) || strlen( $posted ) > 8192 ) return;
		parse_str( $posted, $fields );
		if ( ! is_array( $fields ) || ! isset( $fields['billing_phone'] ) ||
			! is_string( $fields['billing_phone'] ) ) return;
		$selection = array_key_exists( CheckoutConsentCheckbox::CLASSIC_FIELD, $fields );
		// The checkbox may be checked programmatically from a verified status.
		// A routine Woo checkout refresh must NEVER turn that display state into
		// a new GRANT. Only our direct change handler adds these action markers.
		$grant = $selection && ( $fields['moda_interact_whatsapp_recovery_checked_action'] ?? null ) === '1';
		$uncheck = ! $selection && ( $fields['moda_interact_whatsapp_recovery_unchecked_action'] ?? null ) === '1';
		if ( ! $grant && ! $uncheck ) {
			// A phone/account transition can require a neutral unchecked Woo
			// observation before a NEW deliberate GRANT. Allow only that local
			// state transition; it cannot record a consent decision or publish.
			if ( ! $selection && $this->awaitingNeutralClassicSelection() ) {
				$this->observe( 'CLASSIC', false, $fields['billing_phone'],
					CheckoutConsentPhone::verifiedCountry( $fields['billing_country'] ?? null ), true );
			}
			return;
		}
		// The old select/dropdown is intentionally ignored and cannot cause REVOKE.
		$country = CheckoutConsentPhone::verifiedCountry( $fields['billing_country'] ?? null );
		if ( $uncheck && ! $this->hasSameCheckoutGrant( $fields['billing_phone'], $country ) ) {
			// A returning customer's checked checkbox was populated only after a
			// proof-backed status read. Do not require a local observation from
			// this new checkout; the explicit uncheck is a withdrawal command.
			$this->withdrawExplicit( 'CLASSIC', $fields['billing_phone'], $country, true );
			return;
		}
		$this->observe( 'CLASSIC', $selection, $fields['billing_phone'], $country, true, $uncheck );
	}

	public function blocksDraft( mixed $request ): void {
		$this->blocksFromRequest( $request );
	}

	/** Woo's PUT path with an existing (e.g. failed-payment) draft order. */
	public function blocksOrderDraft( mixed $order, mixed $request ): void {
		$this->blocksFromRequest( $request );
	}

	/** Some Store API versions observe the billing-contact update separately. */
	public function blocksCustomer( mixed $customer, mixed $request ): void {
		$this->blocksFromRequest( $request );
	}

	/** Woo's authenticated Store API billing-address update may follow field PUT. */
	public function blocksBillingUpdated( mixed $customer, mixed $request ): void {
		if ( ! is_object( $request ) || ! method_exists( $request, 'get_header' ) ||
			! method_exists( $request, 'get_method' ) || strtoupper( (string ) $request->get_method() ) !== 'POST' ||
			! $this->verifiedStoreApiRequest( $request ) ) return;
		$session = WC()->session ?? null;
		if ( ! $session ) return;
		$stage = $session->get( self::BLOCKS_STAGE );
		if ( ! is_array( $stage ) || ( $stage['checkoutKey'] ?? null ) !== CheckoutKey::current() ||
			( $stage['principal'] ?? null ) !== $this->currentPrincipal() ||
			! is_int( $stage['observedAt'] ?? null ) || time() - $stage['observedAt'] > 240 ) return;
		if ( 'GRANT' !== ( $stage['choice'] ?? null ) ) return;
		$this->observeBlocksCustomer( true, $customer );
	}

	/** A logout/login must not leave a pending consent job attributed to the old identity. */
	public function invalidatePendingSession(): void {
		$session = function_exists( 'WC' ) ? ( WC()->session ?? null ) : null;
		if ( ! $session ) return;
		$state = $session->get( self::SESSION_FIELD );
		if ( is_array( $state ) && is_array( $state['pending'] ?? null ) ) {
			$this->publisher->cancelPending( $state['pending'] );
		}
		$session->set( self::SESSION_FIELD, null );
		$session->set( self::BLOCKS_STAGE, null );
		$this->proof->clearSession();
	}

	/** Read only Moda's pending neutral flag. No WC global initialisation. */
	private function awaitingNeutralClassicSelection(): bool {
		$session = function_exists( 'WC' ) ? ( WC()->session ?? null ) : null;
		if ( ! $session ) return false;
		$state = $session->get( self::SESSION_FIELD );
		return is_array( $state ) && ! empty( $state['awaitingNeutralSelection'] );
	}

	private function currentPrincipal(): ?string {
		$session = WC()->session ?? null;
		if ( ! $session || ! method_exists( $session, 'get_customer_id' ) ) return null;
		$id = (string) $session->get_customer_id();
		return '' === $id ? null : hash( 'sha256', $id . '|' .
			( function_exists( 'get_current_user_id' ) ? (int) get_current_user_id() : 0 ) );
	}

	private function observeBlocksCustomer( bool $checked, mixed $customer, bool $uncheck = false ): void {
		if ( ! is_object( $customer ) || ! method_exists( $customer, 'get_billing_phone' ) ) return;
		$phone = $customer->get_billing_phone();
		$country = method_exists( $customer, 'get_billing_country' ) ? $customer->get_billing_country() : null;
		$verified = CheckoutConsentPhone::verifiedCountry( $country );
		if ( ! is_string( $phone ) || null === CheckoutConsentPhone::normalize( $phone, $verified ) ) return;
		$this->observe( 'BLOCKS', $checked, $phone, $verified, true, $uncheck );
		$session = WC()->session ?? null;
		if ( $session ) $session->set( self::BLOCKS_STAGE, null );
	}

	private function blocksFromRequest( mixed $request ): void {
		if ( ! is_object( $request ) || ! method_exists( $request, 'get_header' ) ||
			! method_exists( $request, 'get_json_params' ) || ! method_exists( $request, 'get_method' ) ||
			! in_array( strtoupper( (string) $request->get_method() ), array( 'PUT', 'PATCH' ), true ) ||
			! $this->verifiedStoreApiRequest( $request ) ) return;
		$payload = $request->get_json_params();
		if ( ! is_array( $payload ) || ! isset( $payload['additional_fields'] ) ||
			! is_array( $payload['additional_fields'] ) ) return;
		$fields = $payload['additional_fields'];
		$has_checkbox = array_key_exists( CheckoutConsentCheckbox::BLOCK_FIELD, $fields );
		$selection = $has_checkbox ? $fields[ CheckoutConsentCheckbox::BLOCK_FIELD ] : null;
		if ( $has_checkbox && ! in_array( $selection, array( true, false, '1', '0', 'true', 'false', 1, 0 ), true ) ) return;
		if ( ! $has_checkbox ) return;
		$checked = in_array( $selection, array( true, '1', 'true', 1 ), true );
		$session = WC()->session ?? null;
		if ( ! $session ) return;
		if ( $checked && null !== CheckoutKey::current() && null !== $this->currentPrincipal() ) {
			$session->set( self::BLOCKS_STAGE, array(
				'checkoutKey' => CheckoutKey::current(), 'principal' => $this->currentPrincipal(),
				'choice' => 'GRANT', 'observedAt' => time(),
			) );
		} else {
			$session->set( self::BLOCKS_STAGE, null );
		}
		// The authenticated Store API explicitly carries this additional field.
		// Only a true -> false transition in the SAME verified checkout can revoke.
		$this->observeBlocksCustomer( $checked, WC()->customer ?? null, $has_checkbox && ! $checked );
	}

	private function verifiedStoreApiRequest( object $request ): bool {
		$nonce = $request->get_header( 'Nonce' );
		if ( is_string( $nonce ) && '' !== $nonce && function_exists( 'wp_verify_nonce' ) &&
			wp_verify_nonce( $nonce, 'wc_store_api' ) ) return true;
		// Woo Store API supports Cart-Token without a Nonce. Only accept a token
		// that Woo has resolved to the CURRENT WC session (never an arbitrary JWT).
		$token = $request->get_header( 'Cart-Token' );
		$class = '\\Automattic\\WooCommerce\\StoreApi\\Utilities\\CartTokenUtils';
		$session = WC()->session ?? null;
		if ( ! is_string( $token ) || '' === $token || ! $session || ! method_exists( $session, 'get_customer_id' ) ||
			! class_exists( $class ) || ! method_exists( $class, 'validate_cart_token' ) ||
			! method_exists( $class, 'get_cart_token' ) ) return false;
		try {
			$expected = $class::get_cart_token( (string) $session->get_customer_id() );
			return is_string( $expected ) && hash_equals( $expected, $token ) && $class::validate_cart_token( $token );
		} catch ( \Throwable $error ) { return false; }
	}

	/** Session observation, transition deduplication and monotonic event identity. */
	public function observe( string $mode, bool $checked, mixed $phone, ?string $country,
		bool $verified, bool $explicit_uncheck = false, ?string $store_choice_id = null ): bool {
		$this->lastFailureReason = 'capture_observe_unclassified';
		if ( ! $verified ) return $this->rejected( 'capture_observe_unverified_context' );
		if ( ! in_array( $mode, array( 'CLASSIC', 'BLOCKS' ), true ) ) {
			return $this->rejected( 'capture_observe_invalid_mode' );
		}
		$woo = function_exists( 'WC' ) ? WC() : null;
		$session = $woo->session ?? null;
		$cart = $woo->cart ?? null;
		if ( ! $session ) return $this->rejected( 'capture_observe_session_unavailable' );
		if ( ! is_object( $cart ) || ! method_exists( $cart, 'get_cart' ) ) {
			return $this->rejected( 'capture_observe_cart_unavailable' );
		}
		// Consult Woo's cart only once; additional reads could invoke merchant filters.
		$items = $cart->get_cart();
		if ( ! is_array( $items ) ) return $this->rejected( 'capture_observe_cart_invalid' );
		if ( count( $items ) === 0 ) return $this->rejected( 'capture_observe_cart_empty' );
		$key = CheckoutKey::current();
		if ( null === $key ) return $this->rejected( 'capture_observe_checkout_key_unavailable' );
		if ( ! is_string( $phone ) ) return $this->rejected( 'capture_observe_phone_missing' );
		$canonical = CheckoutConsentPhone::normalize( $phone, $country );
		if ( null === $canonical ) return $this->rejected( 'capture_observe_phone_invalid' );
		$user_id = function_exists( 'get_current_user_id' ) ? (int) get_current_user_id() : 0;
		$session_id = method_exists( $session, 'get_customer_id' ) ? (string) $session->get_customer_id() : '';
		if ( '' === $session_id ) return $this->rejected( 'capture_observe_session_identity_unavailable' );
		$state = $session->get( self::SESSION_FIELD );
		$prior_identity = is_array( $state ) && isset( $state['principal'] ) && isset( $state['checkoutKey'] );
		$principal = hash( 'sha256', $session_id . '|' . $user_id );
		if ( ! is_array( $state ) || ( $state['checkoutKey'] ?? null ) !== $key ||
			( $state['principal'] ?? null ) !== $principal ) {
			if ( is_array( $state['pending'] ?? null ) ) $this->publisher->cancelPending( $state['pending'] );
			// A changed login/guest session must not inherit another user's checkbox.
			$this->proof->clearSession();
			$state = array( 'checkoutKey' => $key, 'principal' => $principal,
				'canonicalPhone' => $canonical, 'checked' => false,
				'awaitingNeutralSelection' => $prior_identity,
				'observedAt' => null, 'pending' => null );
			$session->set( self::SESSION_FIELD, $state );
			// For a new session, accept a deliberate checked request from the
			// initially unchecked control only if no previous session identity existed.
			if ( $checked && $prior_identity ) {
				return $this->rejected( 'capture_observe_context_change_requires_neutral' );
			}
		}
		if ( $state['canonicalPhone'] !== $canonical ) {
			if ( is_array( $state['pending'] ?? null ) ) $this->publisher->cancelPending( $state['pending'] );
			// A changed phone is never covered by an older grant: require a new
			// unchecked -> checked transition on the newly observed recipient.
			$state['canonicalPhone'] = $canonical;
			$state['checked'] = false;
			$state['awaitingNeutralSelection'] = true;
			$this->proof->clearCurrent();
			$state['pending'] = null;
			// No request receipt may cross a change of the recipient.
			unset( $state['storeChoiceReceipts'], $state['pendingStoreChoiceId'] );
			$session->set( self::SESSION_FIELD, $state );
			return $this->rejected( 'capture_observe_phone_change_requires_neutral' );
		}
		if ( ! empty( $state['awaitingNeutralSelection'] ) ) {
			// A stale checked/withdraw value from another tab is not a fresh
			// decision for a changed account or billing number.
			if ( $checked ) return $this->rejected( 'capture_observe_neutral_selection_required' );
			$state['awaitingNeutralSelection'] = false;
			$session->set( self::SESSION_FIELD, $state );
			return $this->rejected( 'capture_observe_neutral_selection_observed' );
		}
		// A Store API request ID is one explicit checkbox action, never a
		// surrogate for shopper identity. Status reads and checkout draft hooks
		// do not provide one and therefore retain their old deduplication rules.
		$replayed = $this->replayedStoreChoice( $state, $store_choice_id, $checked );
		if ( null !== $replayed ) return $replayed;
		if ( null !== $store_choice_id ) {
			$receipts = $state['storeChoiceReceipts'] ?? array();
			// Reserve space for the current GRANT and a pending retry's ID.
			// Never evict a prior choice to admit a fresh GRANT. A deliberate
			// withdrawal must still be possible after saturation; because no
			// further grants are admitted, its one receipt remains bounded.
			if ( $checked && is_array( $receipts ) &&
				count( $receipts ) >= self::MAX_STORE_CHOICE_RECEIPTS - 2 ) {
				return $this->rejected( 'capture_observe_store_choice_history_full' );
			}
		}
		if ( ! $checked ) {
			// Unchecked is the *initial/default* state on a new checkout. Classic
			// also omits unchecked fields on routine refreshes. Neither is REVOKE.
			if ( ! $explicit_uncheck ) return $this->rejected( 'capture_observe_unchecked_without_action' );
			// An unacknowledged REVOKE is retried with its original identity;
			// never issue multiple revocations for one checkbox transition.
			$pending = $state['pending'] ?? null;
			if ( is_array( $pending ) && 'REVOKE' === ( $pending['decision'] ?? null ) ) {
				if ( $this->publisher->publish( $pending, false ) ) {
					$this->proof->clearCurrent();
					$this->rememberStoreChoice( $state, $state['pendingStoreChoiceId'] ?? null, false );
					$this->rememberStoreChoice( $state, $store_choice_id, false );
					$state['pending'] = null;
					unset( $state['pendingStoreChoiceId'] );
					$session->set( self::SESSION_FIELD, $state );
					return $this->accepted();
				}
				return $this->rejected( 'capture_observe_revoke_retry_unacknowledged' );
			}
			// Only a previously observed CHECKED state in this exact checkout,
			// session and phone authorises an uncheck-triggered withdrawal.
			if ( empty( $state['checked'] ) ) {
				return $this->rejected( 'capture_observe_uncheck_without_prior_grant' );
			}
			$observed_at = $this->timestamp( $state['observedAt'] ?? null );
			if ( null === $observed_at ) {
				return $this->rejected( 'capture_observe_revoke_timestamp_unavailable' );
			}
			$event = array(
				'schemaVersion' => 'woo.whatsapp-consent.v2',
				'eventId' => 'woo-consent-' . bin2hex( random_bytes( 16 ) ),
				'decision' => 'REVOKE',
				'canonicalPhone' => $canonical,
				'occurredAt' => $observed_at,
				'disclosure' => null,
			);
			// A GRANT may have committed even if its HTTP ACK was lost. Cancel
			// deferred GRANT retries; an explicit REVOKE must be sent to Moda.
			if ( is_array( $pending ) ) {
				$this->publisher->cancelPending( $pending );
				$this->rememberStoreChoice( $state, $state['pendingStoreChoiceId'] ?? null,
					'GRANT' === ( $pending['decision'] ?? null ) );
			}
			$state['checked'] = false;
			$state['observedAt'] = $observed_at;
			$state['pending'] = $event;
			$state['pendingStoreChoiceId'] = $store_choice_id;
			$session->set( self::SESSION_FIELD, $state );
			if ( ! $this->publisher->publish( $event ) ) {
				return $this->rejected( 'capture_observe_revoke_publish_unacknowledged' );
			}
			$this->proof->clearCurrent();
			$this->rememberStoreChoice( $state, $store_choice_id, false );
			$state['pending'] = null;
			unset( $state['pendingStoreChoiceId'] );
			$session->set( self::SESSION_FIELD, $state );
			return $this->accepted();
		}
		if ( $state['checked'] ) {
			// Lost-ACK replay: retry the SAME event body and ID.
			if ( is_array( $state['pending'] ?? null ) ) {
				if ( $this->publisher->publish( $state['pending'], false ) ) {
					$this->proof->rememberGrant( $state['pending'] );
					$this->rememberStoreChoice( $state, $state['pendingStoreChoiceId'] ?? null, true );
					$this->rememberStoreChoice( $state, $store_choice_id, true );
					$state['pending'] = null;
					unset( $state['pendingStoreChoiceId'] );
					$session->set( self::SESSION_FIELD, $state );
					return $this->accepted();
				}
				return $this->rejected( 'capture_observe_grant_retry_unacknowledged' );
			}
			// The existing GRANT was acknowledged, but the CURRENT unchecked
			// Blocks control has received a *new*, explicit Store API choice.
			// Only this action may create fresh evidence. Classic/draft refreshes
			// remain deduplicated and status reads never reset session state.
			if ( 'BLOCKS' !== $mode || null === $store_choice_id ) {
				return $this->rejected( 'capture_observe_grant_already_checked' );
			}
		}
		if ( ! ( $this->eligibility ?? new CheckoutConsentEligibility() )->eligible() ) {
			return $this->rejected( 'capture_observe_feature_ineligible' );
		}
		// Never construct a positive event from an unchecked default or a phone match.
		$observed_at = $this->timestamp( $state['observedAt'] ?? null );
		if ( null === $observed_at ) {
			return $this->rejected( 'capture_observe_grant_timestamp_unavailable' );
		}
		$ui = CheckoutConsentCheckbox::disclosure();
		$disclosure = array( 'version' => $ui['version'], 'locale' => $ui['locale'],
			'text' => $ui['text'] );
		$event = array(
			'schemaVersion' => 'woo.whatsapp-consent.v2',
			'eventId' => 'woo-consent-' . bin2hex( random_bytes( 16 ) ),
			'decision' => 'GRANT',
			'canonicalPhone' => $canonical,
			'occurredAt' => $observed_at,
			'disclosure' => $disclosure,
		);
		if ( is_array( $state['pending'] ?? null ) ) {
			$this->publisher->cancelPending( $state['pending'] );
			$this->rememberStoreChoice( $state, $state['pendingStoreChoiceId'] ?? null,
				'GRANT' === ( $state['pending']['decision'] ?? null ) );
		}
		$state['checked'] = $checked;
		$state['observedAt'] = $observed_at;
		$state['pending'] = $event;
		$state['pendingStoreChoiceId'] = $store_choice_id;
		$session->set( self::SESSION_FIELD, $state );
		if ( $this->publisher->publish( $event ) ) {
			$this->proof->rememberGrant( $event );
			$this->rememberStoreChoice( $state, $store_choice_id, true );
			$state['pending'] = null;
			unset( $state['pendingStoreChoiceId'] );
			$session->set( self::SESSION_FIELD, $state );
			return $this->accepted();
		}
		return $this->rejected( 'capture_observe_grant_publish_unacknowledged' );
	}


	/**
	 * Dedicated, confirmed withdrawal command. The caller must separately verify
	 * a real checkout-bound WordPress nonce or Store API Cart-Token, then supply
	 * the Woo-observed billing contact (not a phone-only status query).
	 * Status is ALWAYS rechecked through API-006; with no accepted reader it fails
	 * closed and cannot send a REVOKE event.
	 */
	public function withdrawExplicit( string $mode, mixed $phone, ?string $country, bool $verified, ?string $store_choice_id = null ): bool {
		$this->lastFailureReason = 'capture_withdraw_unclassified';
		if ( ! $verified ) return $this->rejected( 'capture_withdraw_unverified_context' );
		if ( ! in_array( $mode, array( 'CLASSIC', 'BLOCKS' ), true ) ) {
			return $this->rejected( 'capture_withdraw_invalid_mode' );
		}
		if ( ! is_string( $phone ) ) return $this->rejected( 'capture_withdraw_phone_missing' );
		$canonical = CheckoutConsentPhone::normalize( $phone, $country );
		if ( null === $canonical ) return $this->rejected( 'capture_withdraw_phone_invalid' );
		$session = function_exists( 'WC' ) ? ( WC()->session ?? null ) : null;
		$key = CheckoutKey::current();
		$principal = $this->currentPrincipal();
		// A customer's withdrawal must remain possible even if this merchant
		// later disables Checkout Recovery. This is not a new GRANT.
		if ( ! $session ) return $this->rejected( 'capture_withdraw_session_unavailable' );
		if ( null === $key ) return $this->rejected( 'capture_withdraw_checkout_key_unavailable' );
		if ( null === $principal ) return $this->rejected( 'capture_withdraw_principal_unavailable' );
		$state = $session->get( self::SESSION_FIELD );
		// A read proof persists across registered-customer checkouts. A prior
		// checkbox observation in THIS checkout is not a prerequisite for a
		// deliberate, proof-backed withdrawal in a later checkout.
		if ( is_array( $state ) && (
			( $state['checkoutKey'] ?? null ) !== $key ||
			( $state['principal'] ?? null ) !== $principal ||
			( $state['canonicalPhone'] ?? null ) !== $canonical
		) ) {
			// Old, completed checkout observation may outlive the page. Do not
			// borrow its checkbox state, but do not reject a NEW explicit
			// withdrawal where this shopper has a valid API-006 proof either.
			// Pending events are never silently discarded across contexts.
			if ( is_array( $state['pending'] ?? null ) ) {
				return $this->rejected( 'capture_withdraw_context_mismatch' );
			}
			$state = null;
		}
		if ( ! is_array( $state ) ) {
			$state = array( 'checkoutKey' => $key, 'principal' => $principal,
				'canonicalPhone' => $canonical, 'checked' => false,
				'observedAt' => null, 'pending' => null );
		}
		// A retry of an acknowledged Store API withdrawal is idempotent, but
		// replaying it after a newer GRANT must not revoke that newer decision.
		$replayed = $this->replayedStoreChoice( $state, $store_choice_id, false );
		if ( null !== $replayed ) return $replayed;
		$pending = $state['pending'] ?? null;
		// If an earlier withdrawal's ACK was lost, retry the identical event.
		if ( is_array( $pending ) && 'REVOKE' === ( $pending['decision'] ?? null ) ) {
			$event = $pending;
		} else {
			$proof = $this->proof->forCurrentShopper( $canonical );
			if ( null === $proof ) return $this->rejected( 'capture_withdraw_proof_unavailable' );
			if ( ! $this->status->confirmed( $proof ) ) {
				return $this->rejected( 'capture_withdraw_status_unconfirmed' );
			}
			// Observe the deliberate withdrawal NOW, rather than replaying the old
			// GRANT's timestamp (the hosted API rejects stale decisions).
			$observed = $this->timestamp( $state['observedAt'] ?? null );
			if ( null === $observed ) {
				return $this->rejected( 'capture_withdraw_timestamp_unavailable' );
			}
			$event = array(
				'schemaVersion' => 'woo.whatsapp-consent.v2',
				'eventId' => 'woo-consent-' . bin2hex( random_bytes( 16 ) ),
				'decision' => 'REVOKE',
				'canonicalPhone' => $canonical,
				'occurredAt' => $observed,
				'disclosure' => null,
			);
			if ( is_array( $pending ) ) $this->publisher->cancelPending( $pending );
			$state['pending'] = $event;
			$state['pendingStoreChoiceId'] = $store_choice_id;
			$state['observedAt'] = $observed;
			$session->set( self::SESSION_FIELD, $state );
		}
		if ( ! $this->publisher->publish( $event ) ) {
			return $this->rejected( 'capture_withdraw_publish_unacknowledged' );
		}
		$this->proof->clearCurrent();
		$state['checked'] = false;
		$this->rememberStoreChoice( $state, $state['pendingStoreChoiceId'] ?? $store_choice_id, false );
		$this->rememberStoreChoice( $state, $store_choice_id, false );
		$state['pending'] = null;
		unset( $state['pendingStoreChoiceId'] );
		$session->set( self::SESSION_FIELD, $state );
		return $this->accepted();
	}

	/**
	 * Does this authenticated, currently established checkout have an
	 * acknowledged (or pending) local GRANT to reverse? Read-only: do not
	 * initialise WC, create a checkout key or clear a saved guest proof.
	 * Returning customers without a same-checkout observation are handled by
	 * withdrawExplicit(), which rechecks the saved proof against API-006.
	 */
	public function hasSameCheckoutGrant( mixed $phone, ?string $country, ?string $request_id = null ): bool {
		$canonical = is_string( $phone ) ? CheckoutConsentPhone::normalize( $phone, $country ) : null;
		$session = function_exists( 'WC' ) ? ( WC()->session ?? null ) : null;
		if ( null === $canonical || ! $session ) return false;
		$key = CheckoutKey::existing();
		$principal = $this->currentPrincipal();
		if ( null === $key || null === $principal ) return false;
		$state = $session->get( self::SESSION_FIELD );
		if ( ! is_array( $state ) || ( $state['checkoutKey'] ?? null ) !== $key ||
			( $state['principal'] ?? null ) !== $principal ||
			( $state['canonicalPhone'] ?? null ) !== $canonical ||
			! empty( $state['awaitingNeutralSelection'] ) ) return false;
		$receipts = $state['storeChoiceReceipts'] ?? null;
		$has_receipt = null !== $request_id && is_array( $receipts ) &&
			isset( $receipts[ hash( 'sha256', $request_id ) ] );
		return ! empty( $state['checked'] ) || $has_receipt;
	}

	/** No proof and no live API-006 confirmation means a neutral checkout UI. */
	public function hasConfirmedPermission( mixed $phone, ?string $country ): bool {
		return $this->permissionStatus( $phone, $country )['confirmed'];
	}

	/** Never return local grant capabilities, phone, or provider STOP details. */
	public function permissionStatus( mixed $phone, ?string $country ): array {
		if ( ! is_string( $phone ) ) return array( 'confirmed' => false,
			'reason' => 'consent_status_phone_missing' );
		$canonical = CheckoutConsentPhone::normalize( $phone, $country );
		if ( null === $canonical ) return array( 'confirmed' => false,
			'reason' => 'consent_status_phone_invalid' );
		$local = $this->proof->inspectForCurrentShopper( $canonical );
		if ( null === $local['proof'] ) return array( 'confirmed' => false,
			'reason' => $local['reason'] );
		return $this->status->inspect( $local['proof'] );
	}

	private function timestamp( mixed $previous ): ?string {
		for ( $i = 0; $i < 4; $i++ ) {
			$now = gmdate( 'Y-m-d\TH:i:s', time() ) . sprintf( '.%03dZ', ( (int) floor( microtime( true ) * 1000 ) ) % 1000 );
			if ( ! is_string( $previous ) || strcmp( $now, $previous ) > 0 ) return $now;
			usleep( 3000 );
		}
		return null;
	}

	public function endCheckout(): void {
		$session = function_exists( 'WC' ) ? ( WC()->session ?? null ) : null;
		if ( $session ) {
			$session->set( self::SESSION_FIELD, null );
			$session->set( self::BLOCKS_STAGE, null );
			// A guest proof cannot survive checkout/cart completion.
			$this->proof->clearSession();
		}
	}
}
