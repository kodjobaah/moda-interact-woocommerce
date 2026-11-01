<?php

namespace ModaInteract\WooCommerce;

defined( 'ABSPATH' ) || exit;

// Bundled production Composer loaders are class-map authoritative.
// This bounded feature is explicitly loaded without requiring a vendor rebuild.
require_once __DIR__ . '/Api/DiscountOffersContracts.php';
require_once __DIR__ . '/Api/WooRestoreResolveResponseValidator.php';
require_once __DIR__ . '/Api/UsageHistoryResponseValidator.php';
require_once __DIR__ . '/Api/AiResponseDelayResponseValidator.php';
require_once __DIR__ . '/Rest/AiResponseDelayController.php';
require_once __DIR__ . '/Rest/UsageHistoryController.php';
require_once __DIR__ . '/Api/SupportResponseValidator.php';
require_once __DIR__ . '/Rest/SupportController.php';
require_once __DIR__ . '/Api/PromotionsResponseValidator.php';
require_once __DIR__ . '/Rest/PromotionsController.php';
require_once __DIR__ . '/Api/RecoverySelectionContracts.php';
require_once __DIR__ . '/Api/ConversationCommandContracts.php';
require_once __DIR__ . '/Rest/RecoveryConversationCommandController.php';
require_once __DIR__ . '/Rest/RecoverySelectionController.php';
require_once __DIR__ . '/Rest/RecoveryDiscountOffersController.php';
require_once __DIR__ . '/Api/MerchantKnowledgeContracts.php';
require_once __DIR__ . '/Rest/MerchantKnowledgeController.php';
require_once __DIR__ . '/Checkout/CheckoutKey.php';
require_once __DIR__ . '/Checkout/CheckoutDiagnosticLogger.php';
require_once __DIR__ . '/Checkout/CheckoutSnapshot.php';
require_once __DIR__ . '/Checkout/CheckoutActivityPublisher.php';
require_once __DIR__ . '/Checkout/CheckoutCapture.php';
require_once __DIR__ . '/Checkout/CheckoutConsentDiagnostics.php';
require_once __DIR__ . '/Checkout/CheckoutCartRestorer.php';
require_once __DIR__ . '/Checkout/CheckoutCouponRestorer.php';
require_once __DIR__ . '/Checkout/CheckoutCouponOutcomeHandler.php';
require_once __DIR__ . '/Checkout/CheckoutResumeController.php';
require_once __DIR__ . '/Checkout/CheckoutConsentEligibility.php';
require_once __DIR__ . '/Checkout/CheckoutConsentCheckbox.php';
require_once __DIR__ . '/Checkout/CheckoutConsentPhone.php';
require_once __DIR__ . '/Checkout/CheckoutConsentPublisher.php';
require_once __DIR__ . '/Checkout/CheckoutConsentProof.php';
require_once __DIR__ . '/Checkout/CheckoutConsentStatusReader.php';
require_once __DIR__ . '/Checkout/CheckoutConsentActions.php';
require_once __DIR__ . '/Checkout/CheckoutConsentStoreApi.php';
require_once __DIR__ . '/Checkout/CheckoutConsentPresentation.php';
require_once __DIR__ . '/Checkout/CheckoutConsentCapture.php';
require_once __DIR__ . '/Checkout/OrderLifecycleCapture.php';
require_once __DIR__ . '/ShopBrand/SourceReader.php';
require_once __DIR__ . '/ShopBrand/SnapshotBuilder.php';
require_once __DIR__ . '/ShopBrand/Publisher.php';
require_once __DIR__ . '/ShopBrand/SyncStatusStore.php';
require_once __DIR__ . '/Rest/ShopBrandSyncController.php';

use ModaInteract\WooCommerce\Admin\Setup;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\ModaApiConfigurationException;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\BillingController;
use ModaInteract\WooCommerce\Rest\ConnectionController;
use ModaInteract\WooCommerce\Rest\StoreContextController;
use ModaInteract\WooCommerce\Rest\StoreCategoryController;
use ModaInteract\WooCommerce\Rest\RecoverySummaryController;
use ModaInteract\WooCommerce\Rest\RecoveryPolicyController;
use ModaInteract\WooCommerce\Rest\AiResponseDelayController;
use ModaInteract\WooCommerce\Rest\RecoveryCouponCatalogueController;
use ModaInteract\WooCommerce\Rest\RecoveryDiscountOffersController;
use ModaInteract\WooCommerce\Rest\RecoveryListController;
use ModaInteract\WooCommerce\Rest\RecoveryDetailController;
use ModaInteract\WooCommerce\Rest\RecoveryConversationCommandController;
use ModaInteract\WooCommerce\Rest\ReadAccessController;
use ModaInteract\WooCommerce\Rest\MerchantKnowledgeController;
use ModaInteract\WooCommerce\Rest\UsageHistoryController;
use ModaInteract\WooCommerce\Rest\SupportController;
use ModaInteract\WooCommerce\Rest\PromotionsController;
use ModaInteract\WooCommerce\Rest\RecoverySelectionController;
use ModaInteract\WooCommerce\Rest\ShopBrandSyncController;
use ModaInteract\WooCommerce\Checkout\CheckoutCapture;
use ModaInteract\WooCommerce\Checkout\CheckoutCartRestorer;
use ModaInteract\WooCommerce\Checkout\CheckoutResumeController;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentCheckbox;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentEligibility;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentCapture;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentActions;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentStoreApi;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentPresentation;
use ModaInteract\WooCommerce\Checkout\CheckoutConsentPublisher;
use ModaInteract\WooCommerce\Checkout\CheckoutActivityPublisher;
use ModaInteract\WooCommerce\Checkout\OrderLifecycleCapture;
use ModaInteract\WooCommerce\ShopBrand\Publisher as ShopBrandPublisher;

final class Runtime {
	private const MINIMUM_WOOCOMMERCE_VERSION = '11.0';

	private bool $booted = false;

	private bool $initialized = false;

	private bool $notice_registered = false;

	private ?string $woocommerce_version;

	public function __construct( ?string $woocommerce_version ) {
		$this->woocommerce_version = $woocommerce_version;
	}

	public function boot(): void {
		if ( $this->booted ) {
			return;
		}

		$this->booted = true;
		add_action( 'init', array( Plugin::class, 'load_textdomain' ) );

		if ( null === $this->woocommerce_version ) {
			$this->register_dependency_notice();
			return;
		}

		if ( ! version_compare( $this->woocommerce_version, self::MINIMUM_WOOCOMMERCE_VERSION, '>=' ) ) {
			$this->register_dependency_notice();
			return;
		}

		add_action( 'woocommerce_init', array( $this, 'initialize' ), 10, 0 );
	}

	public function initialize(): void {
		if ( $this->initialized ) {
			return;
		}

		$this->woocommerce_version = Plugin::woocommerce_version();
		if ( null === $this->woocommerce_version || ! version_compare( $this->woocommerce_version, self::MINIMUM_WOOCOMMERCE_VERSION, '>=' ) ) {
			$this->register_dependency_notice();
			return;
		}

		$this->initialized = true;
		try {
			$mode = ModaApiConfiguration::serverMode();
		} catch ( ModaApiConfigurationException $error ) {
			$mode = ModaApiConfiguration::MODE_PUBLIC;
		}
		( new ConnectionController( null, new SiteIdentity( $mode ) ) )->register();
		( new BillingController( null, new SiteIdentity( $mode ) ) )->register();
		( new StoreContextController( null, new SiteIdentity( $mode ) ) )->register();
		( new StoreCategoryController( null, new SiteIdentity( $mode ) ) )->register();
		( new RecoverySummaryController( null, new SiteIdentity( $mode ) ) )->register();
		( new RecoveryPolicyController( null, new SiteIdentity( $mode ) ) )->register();
		( new AiResponseDelayController( null, new SiteIdentity( $mode ) ) )->register();
		( new RecoveryCouponCatalogueController() )->register();
		( new RecoveryDiscountOffersController( null, new SiteIdentity( $mode ) ) )->register();
		( new RecoveryListController( null, new SiteIdentity( $mode ) ) )->register();
		( new RecoveryDetailController( null, new SiteIdentity( $mode ) ) )->register();
		( new RecoveryConversationCommandController( null, new SiteIdentity( $mode ) ) )->register();
		( new ReadAccessController( null, new SiteIdentity( $mode ) ) )->register();
		( new MerchantKnowledgeController( null, new SiteIdentity( $mode ) ) )->register();
		( new UsageHistoryController( null, new SiteIdentity( $mode ) ) )->register();
		( new SupportController( null, new SiteIdentity( $mode ) ) )->register();
		( new PromotionsController( null, new SiteIdentity( $mode ) ) )->register();
( new RecoverySelectionController( null, new SiteIdentity( $mode ) ) )->register();
		$activity_publisher = new CheckoutActivityPublisher();
		$checkout_capture = new CheckoutCapture( $activity_publisher );
		$checkout_capture->register();
		( new CheckoutResumeController( $checkout_capture, new CheckoutCartRestorer( $checkout_capture ) ) )->register();
		// Presentation hooks share ONE cheap local installation check per request.
		// Do not synchronously fetch merchant features during checkout rendering.
		// Actual GRANT admission always revalidates remotely via eligible().
		$consent_eligibility = new CheckoutConsentEligibility();
		$checkout_consent_visible = static fn(): bool => $consent_eligibility->eligibleForPresentation();
		( new CheckoutConsentCheckbox( $checkout_consent_visible ) )->register();
		$consent_capture = new CheckoutConsentCapture( new CheckoutConsentPublisher(), $consent_eligibility );
		$consent_capture->register();
		( new CheckoutConsentActions( $consent_capture ) )->register();
		( new CheckoutConsentStoreApi( $consent_capture ) )->register();
		( new CheckoutConsentPresentation( $checkout_consent_visible ) )->register();
		( new OrderLifecycleCapture( $activity_publisher ) )->register();
		$brand_publisher = new ShopBrandPublisher();
		$brand_publisher->register();
		( new ShopBrandSyncController( $brand_publisher, new SiteIdentity( $mode ) ) )->register();
		if ( is_admin() ) {
			new Setup();
		}
	}

	public function render_dependency_notice(): void {
		if ( ! is_admin() || ! current_user_can( 'activate_plugins' ) ) {
			return;
		}

		if ( null === $this->woocommerce_version ) {
			$message = __(
				'Moda Interact requires WooCommerce 11.0 or later to be installed and active.',
				'moda-interact'
			);
		} else {
			$message = sprintf(
				/* translators: 1: minimum supported WooCommerce version, 2: detected WooCommerce version. */
				__(
					'Moda Interact requires WooCommerce %1$s or later. Detected version: %2$s.',
					'moda-interact'
				),
				self::MINIMUM_WOOCOMMERCE_VERSION,
				$this->woocommerce_version
			);
		}

		echo '<div class="notice notice-error"><p>' . esc_html( $message ) . '</p></div>';
	}

	private function register_dependency_notice(): void {
		if ( $this->notice_registered ) {
			return;
		}

		$this->notice_registered = true;
		add_action( 'admin_notices', array( $this, 'render_dependency_notice' ) );
	}
}
