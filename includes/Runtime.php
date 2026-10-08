<?php

namespace ModaInteract\WooCommerce;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Admin\Setup;
use ModaInteract\WooCommerce\Api\ModaApiConfiguration;
use ModaInteract\WooCommerce\Api\ModaApiConfigurationException;
use ModaInteract\WooCommerce\Connection\SiteIdentity;
use ModaInteract\WooCommerce\Rest\ConnectionController;

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