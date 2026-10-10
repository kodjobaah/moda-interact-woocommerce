<?php

use ModaInteract\WooCommerce\Admin\Setup;
use ModaInteract\WooCommerce\Plugin;
use ModaInteract\WooCommerce\Runtime;
use PHPUnit\Framework\TestCase;

/** Test-only observer for WooCommerce's HPOS feature declaration. */
final class ModaInteractHposFeatureUtilProbe {
	public static array $declarations = array();

	public static function declare_compatibility( string $feature, string $plugin_file, bool $compatible ): void {
		self::$declarations[] = array( $feature, $plugin_file, $compatible );
	}
}

if ( ! class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class, false ) ) {
	class_alias( ModaInteractHposFeatureUtilProbe::class, \Automattic\WooCommerce\Utilities\FeaturesUtil::class );
}

final class PluginTest extends TestCase {
	protected function setUp(): void {
		$GLOBALS['moda_interact_test_hooks'] = $GLOBALS['moda_interact_initial_hooks'];
		$GLOBALS['moda_interact_registered_pages'] = array();
		$GLOBALS['moda_interact_native_menu'] = array();
		$GLOBALS['moda_interact_native_submenus'] = array();
		$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
		$GLOBALS['moda_interact_is_admin'] = true;
		$GLOBALS['moda_interact_can_activate_plugins'] = true;
		$GLOBALS['moda_interact_current_screen_id'] = 'woocommerce_page_wc-admin';
		$GLOBALS['moda_interact_registered_scripts'] = array();
		$GLOBALS['moda_interact_inline_scripts'] = array();
		$GLOBALS['moda_interact_script_translations'] = array();
		$GLOBALS['moda_interact_registered_styles'] = array();
		$GLOBALS['moda_interact_enqueued_scripts'] = array();
		$GLOBALS['moda_interact_enqueued_styles'] = array();
		$GLOBALS['moda_interact_external_requests'] = array();
		$GLOBALS['moda_interact_deleted_options'] = array();
		ModaInteractHposFeatureUtilProbe::$declarations = array();
	}

	public function test_bootstrap_registers_bounded_lifecycle_hooks(): void {
		self::assertSame( array( Plugin::class, 'activate' ), $GLOBALS['moda_interact_activation_callback'] );
		self::assertSame( array( Plugin::class, 'deactivate' ), $GLOBALS['moda_interact_deactivation_callback'] );
		self::assertSame( array( Plugin::class, 'boot' ), $GLOBALS['moda_interact_initial_hooks']['plugins_loaded'][0] );
	}

	public function test_registers_wordpress_textdomain_at_init_not_plugins_loaded(): void {
		self::assertContains(
			array( Plugin::class, 'load_textdomain' ),
			$GLOBALS['moda_interact_initial_hooks']['init']
		);
		self::assertNotContains(
			array( Plugin::class, 'load_textdomain' ),
			$GLOBALS['moda_interact_initial_hooks']['plugins_loaded']
		);
		Plugin::load_textdomain();
		self::assertSame( 'moda-interact', $GLOBALS['moda_interact_loaded_textdomain'] );
	}

	public function test_declares_hpos_compatibility_before_woocommerce_initializes(): void {
		self::assertCount( 1, $GLOBALS['moda_interact_initial_hooks']['before_woocommerce_init'] );
		self::assertSame(
			array( Plugin::class, 'declare_hpos_compatibility' ),
			$GLOBALS['moda_interact_initial_hooks']['before_woocommerce_init'][0]
		);

		call_user_func( $GLOBALS['moda_interact_initial_hooks']['before_woocommerce_init'][0] );
		self::assertSame(
			array( array( 'custom_order_tables', MODA_INTERACT_MAIN_PLUGIN_FILE, true ) ),
			ModaInteractHposFeatureUtilProbe::$declarations
		);
	}

	public function test_plugin_headers_declare_the_supported_window(): void {
		$bootstrap = file_get_contents( dirname( __DIR__ ) . '/moda-interact.php' );

		foreach (
			array(
				'Requires at least: 7.0',
				'Tested up to: 7.1',
				'Requires PHP: 8.1',
				'Requires Plugins: woocommerce',
				'WC requires at least: 11.0',
				'WC tested up to: 11.1',
			) as $header
		) {
			self::assertStringContainsString( $header, $bootstrap );
		}
	}

	public function test_missing_woocommerce_leaves_runtime_inert_and_notifies_admin(): void {
		$runtime = new Runtime( null );
		$runtime->boot();

		self::assertArrayNotHasKey( 'woocommerce_init', $GLOBALS['moda_interact_test_hooks'] );
		self::assertCount( 1, $GLOBALS['moda_interact_test_hooks']['admin_notices'] );

		ob_start();
		$runtime->render_dependency_notice();
		$notice = ob_get_clean();

		self::assertStringContainsString( 'requires WooCommerce 11.0 or later', $notice );
		self::assertStringContainsString( 'installed and active', $notice );
	}

	public function test_unsupported_woocommerce_leaves_runtime_inert_and_reports_version(): void {
		$runtime = new Runtime( '10.9.9' );
		$runtime->boot();

		self::assertArrayNotHasKey( 'woocommerce_init', $GLOBALS['moda_interact_test_hooks'] );
		ob_start();
		$runtime->render_dependency_notice();
		$notice = ob_get_clean();

		self::assertStringContainsString( 'requires WooCommerce 11.0 or later', $notice );
		self::assertStringContainsString( 'Detected version: 10.9.9', $notice );
	}

	public function test_dependency_notice_is_hidden_from_storefront_and_unprivileged_users(): void {
		$runtime = new Runtime( null );
		$runtime->boot();
		$GLOBALS['moda_interact_is_admin'] = false;

		ob_start();
		$runtime->render_dependency_notice();
		$storefront_output = ob_get_clean();

		$GLOBALS['moda_interact_is_admin'] = true;
		$GLOBALS['moda_interact_can_activate_plugins'] = false;
		ob_start();
		$runtime->render_dependency_notice();
		$unprivileged_output = ob_get_clean();

		self::assertSame( '', $storefront_output );
		self::assertSame( '', $unprivileged_output );
	}

	public function test_supported_runtime_initializes_after_woocommerce_once(): void {
		$runtime = new Runtime( '11.1.2' );
		$runtime->boot();
		$runtime->boot();

		self::assertArrayNotHasKey( 'admin_menu', $GLOBALS['moda_interact_test_hooks'] );
		self::assertCount( 1, $GLOBALS['moda_interact_test_hooks']['woocommerce_init'] );

		$initialize = $GLOBALS['moda_interact_test_hooks']['woocommerce_init'][0];
		$initialize();
		$initialize();

		self::assertCount( 1, $GLOBALS['moda_interact_test_hooks']['admin_menu'] );
		self::assertCount( 1, $GLOBALS['moda_interact_test_hooks']['admin_enqueue_scripts'] );
	}

	public function test_activation_and_deactivation_have_no_remote_or_destructive_side_effects(): void {
		call_user_func( $GLOBALS['moda_interact_activation_callback'] );
		call_user_func( $GLOBALS['moda_interact_deactivation_callback'] );

		self::assertSame( array(), $GLOBALS['moda_interact_external_requests'] );
		self::assertSame( array(), $GLOBALS['moda_interact_deleted_options'] );
	}

	public function test_admin_page_uses_the_canonical_woocommerce_route(): void {
		$setup = new Setup();
		$setup->register_page();

		self::assertSame(
			array(
				'id'     => 'moda-interact',
				'title'  => 'Moda Interact',
				'parent' => 'woocommerce',
				'path'   => '/moda-interact',
			),
			$GLOBALS['moda_interact_registered_pages'][0]
		);
	}

	public function test_native_menu_matches_shopify_order_with_supported_and_planned_pages(): void {
		$setup = new Setup();
		$setup->register_page();

		self::assertCount( 1, $GLOBALS['moda_interact_native_menu'] );
		self::assertSame( 'moda-interact', $GLOBALS['moda_interact_native_menu'][0]['slug'] );
		self::assertSame( 'manage_woocommerce', $GLOBALS['moda_interact_native_menu'][0]['capability'] );
		self::assertSame( 'dashicons-store', $GLOBALS['moda_interact_native_menu'][0]['icon'] );
		self::assertSame(
			array( 'Overview', 'Recoveries', 'Billing', 'Promotions', 'Support', 'Recovery settings' ),
			array_column( $GLOBALS['moda_interact_native_submenus'], 'menu_title' )
		);
		self::assertSame(
			array( 'moda-interact', 'moda-interact-recoveries', 'moda-interact-billing', 'moda-interact-promotions', 'moda-interact-support', 'moda-interact-recovery-settings' ),
			array_column( $GLOBALS['moda_interact_native_submenus'], 'slug' )
		);
		foreach ( $GLOBALS['moda_interact_native_submenus'] as $submenu ) {
			self::assertSame( 'moda-interact', $submenu['parent'] );
			self::assertSame( 'manage_woocommerce', $submenu['capability'] );
		}

		ob_start();
		call_user_func( $GLOBALS['moda_interact_native_submenus'][2]['callback'] );
		$app = ob_get_clean();
		self::assertStringContainsString( 'id="moda-interact-native-root"', $app );

		ob_start();
		call_user_func( $GLOBALS['moda_interact_native_submenus'][1]['callback'] );
		$planned = ob_get_clean();
		self::assertStringContainsString( 'Recoveries', $planned );
		self::assertStringContainsString( 'not yet available for WooCommerce', $planned );
		self::assertStringNotContainsString( 'moda-interact-native-root', $planned );
	}

	public function test_native_navigation_checks_merchant_capability_and_only_loads_app_assets(): void {
		$setup = new Setup();
		$setup->register_page();

		foreach ( array( 'toplevel_page_moda-interact', 'moda-interact_page_moda-interact-billing', 'moda-interact_page_moda-interact-recovery-settings' ) as $screen ) {
			$GLOBALS['moda_interact_current_screen_id'] = $screen;
			$setup->register_scripts();
		}
		self::assertCount( 3, $GLOBALS['moda_interact_enqueued_scripts'] );

		$GLOBALS['moda_interact_current_screen_id'] = 'moda-interact_page_moda-interact-promotions';
		$setup->register_scripts();
		self::assertCount( 3, $GLOBALS['moda_interact_enqueued_scripts'] );

		$GLOBALS['moda_interact_can_manage_woocommerce'] = false;
		ob_start();
		call_user_func( $GLOBALS['moda_interact_native_menu'][0]['callback'] );
		self::assertSame( '', ob_get_clean() );
		ob_start();
		call_user_func( $GLOBALS['moda_interact_native_submenus'][3]['callback'] );
		self::assertSame( '', ob_get_clean() );
	}

	public function test_assets_load_only_on_the_woocommerce_admin_screen(): void {
		$setup = new Setup();
		$GLOBALS['moda_interact_user_locale'] = 'de_DE';
		$GLOBALS['moda_interact_store_locale'] = 'fr_FR';
		$GLOBALS['moda_interact_current_screen_id'] = 'dashboard';
		$setup->register_scripts();

		self::assertSame( array(), $GLOBALS['moda_interact_enqueued_scripts'] );
		self::assertSame( array(), $GLOBALS['moda_interact_enqueued_styles'] );

		$GLOBALS['moda_interact_current_screen_id'] = 'woocommerce_page_wc-admin';
		$setup->register_scripts();

		self::assertSame( array( 'moda-interact' ), $GLOBALS['moda_interact_enqueued_scripts'] );
		self::assertSame( array( 'moda-interact' ), $GLOBALS['moda_interact_enqueued_styles'] );
		self::assertSame(
			array( array( 'moda-interact', 'moda-interact', dirname( __DIR__ ) . '/languages' ) ),
			$GLOBALS['moda_interact_script_translations']
		);
		self::assertSame( 'before', $GLOBALS['moda_interact_inline_scripts'][0][2] );
		self::assertStringContainsString( '"user":"de_DE"', $GLOBALS['moda_interact_inline_scripts'][0][1] );
		self::assertStringContainsString( '"site":"fr_FR"', $GLOBALS['moda_interact_inline_scripts'][0][1] );
	}
}