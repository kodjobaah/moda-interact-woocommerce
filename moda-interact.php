<?php
/**
 * Plugin Name: Moda Interact
 * Description: A WooCommerce Admin extension foundation for Moda Interact.
 * Version: 0.1.0
 * Requires at least: 7.0
 * Tested up to: 7.1
 * Requires PHP: 8.1
 * Requires Plugins: woocommerce
 * WC requires at least: 11.0
 * WC tested up to: 11.1
 * Text Domain: moda-interact
 * Domain Path: /languages
 *
 * License: GNU General Public License v3.0
 * License URI: http://www.gnu.org/licenses/gpl-3.0.html
 *
 * @package ModaInteract\WooCommerce
 */
namespace ModaInteract\WooCommerce;

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'MODA_INTERACT_MAIN_PLUGIN_FILE' ) ) {
	define( 'MODA_INTERACT_MAIN_PLUGIN_FILE', __FILE__ );
}

require_once __DIR__ . '/vendor/autoload.php';


register_activation_hook( __FILE__, array( Plugin::class, 'activate' ) );
register_deactivation_hook( __FILE__, array( Plugin::class, 'deactivate' ) );
add_action( 'plugins_loaded', array( Plugin::class, 'boot' ), 20 );
