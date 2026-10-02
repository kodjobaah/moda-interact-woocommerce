<?php

use ModaInteract\WooCommerce\Admin\Setup;
use ModaInteract\WooCommerce\Plugin;
use PHPUnit\Framework\TestCase;

final class PluginTest extends TestCase {
	public function test_bootstrap_registers_activation_and_load_hooks(): void {
		self::assertSame( array( Plugin::class, 'activate' ), $GLOBALS['moda_interact_activation_callback'] );
		self::assertSame( array( Plugin::class, 'boot' ), $GLOBALS['moda_interact_test_hooks']['plugins_loaded'][0] );
	}

	public function test_boot_loads_text_domain_and_registers_admin_hooks(): void {
		Plugin::boot();

		self::assertSame( 'moda-interact', $GLOBALS['moda_interact_loaded_textdomain'] );
		self::assertCount( 1, $GLOBALS['moda_interact_test_hooks']['admin_menu'] );
		self::assertCount( 1, $GLOBALS['moda_interact_test_hooks']['admin_enqueue_scripts'] );
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
}