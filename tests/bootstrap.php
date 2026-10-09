<?php

use ModaInteract\WooCommerce\Plugin;

define( 'ABSPATH', dirname( __DIR__ ) . '/' );
$GLOBALS['moda_interact_test_hooks'] = array();
$GLOBALS['moda_interact_registered_pages'] = array();
$GLOBALS['moda_interact_is_admin'] = true;
$GLOBALS['moda_interact_can_activate_plugins'] = true;
$GLOBALS['moda_interact_current_screen_id'] = 'woocommerce_page_wc-admin';
$GLOBALS['moda_interact_registered_scripts'] = array();
$GLOBALS['moda_interact_registered_styles'] = array();
$GLOBALS['moda_interact_enqueued_scripts'] = array();
$GLOBALS['moda_interact_enqueued_styles'] = array();
$GLOBALS['moda_interact_external_requests'] = array();
$GLOBALS['moda_interact_deleted_options'] = array();
$GLOBALS['moda_interact_options'] = array();
$GLOBALS['moda_interact_option_autoload'] = array();
$GLOBALS['moda_interact_transients'] = array();
$GLOBALS['moda_interact_scheduled_events'] = array();
$GLOBALS['moda_interact_registered_rest_routes'] = array();
$GLOBALS['moda_interact_home_url'] = 'https://merchant.example';
$GLOBALS['moda_interact_store_locale'] = 'en_GB';
$GLOBALS['moda_interact_base_location'] = array( 'country' => 'GB', 'state' => '' );
$GLOBALS['moda_interact_can_manage_woocommerce'] = true;
$GLOBALS['moda_interact_fail_option_writes'] = false;
define( 'WC_VERSION', '11.1.2' );

function add_action( $hook, $callback, $priority = 10, $accepted_args = 1 ) {
	$GLOBALS['moda_interact_test_hooks'][ $hook ][] = $callback;
}

function register_activation_hook( $file, $callback ) {
	$GLOBALS['moda_interact_activation_callback'] = $callback;
}

function register_deactivation_hook( $file, $callback ) {
	$GLOBALS['moda_interact_deactivation_callback'] = $callback;
}

function load_plugin_textdomain( $domain, $deprecated = false, $plugin_rel_path = false ) {
	$GLOBALS['moda_interact_loaded_textdomain'] = $domain;
}

function plugin_basename( $file ) {
	return basename( dirname( $file ) ) . '/' . basename( $file );
}

function is_admin() {
	return $GLOBALS['moda_interact_is_admin'];
}

function current_user_can( $capability ) {
	if ( 'manage_woocommerce' === $capability ) {
		return $GLOBALS['moda_interact_can_manage_woocommerce'];
	}
	return 'activate_plugins' === $capability && $GLOBALS['moda_interact_can_activate_plugins'];
}

function get_user_locale() {
	return $GLOBALS['moda_interact_user_locale'] ?? 'en_US';
}

function home_url( $path = '/' ) {
	return rtrim( $GLOBALS['moda_interact_home_url'], '/' ) . ( '/' === $path ? '' : '/' . ltrim( $path, '/' ) );
}

function rest_url( $path = '' ) {
	if ( isset( $GLOBALS['moda_interact_rest_url'] ) ) {
		return $GLOBALS['moda_interact_rest_url'];
	}
	return rtrim( home_url( '/' ), '/' ) . '/wp-json/' . ltrim( $path, '/' );
}

function register_rest_route( $namespace, $route, $args ) {
	$GLOBALS['moda_interact_registered_rest_routes'][ $namespace . $route ] = $args;
	return true;
}

function __return_true() {
	return true;
}

function get_current_screen() {
	return (object) array( 'id' => $GLOBALS['moda_interact_current_screen_id'] );
}

function __( $text, $domain = 'default' ) {
	return $text;
}

function esc_html__( $text, $domain = 'default' ) {
	return $text;
}

function esc_html( $text ) {
	return $text;
}

function wc_admin_register_page( $page ) {
	$GLOBALS['moda_interact_registered_pages'][] = $page;
}

function plugins_url( $path, $plugin_file ) {
	return 'https://example.org/plugins' . $path;
}

function wp_register_script( $handle, $src, $dependencies, $version, $in_footer ) {
	$GLOBALS['moda_interact_registered_scripts'][] = $handle;
}

function wp_set_script_translations( $handle, $domain, $path = null ) {
	$GLOBALS['moda_interact_script_translations'][] = array( $handle, $domain, $path );
}

function wp_register_style( $handle, $src, $dependencies, $version ) {
	$GLOBALS['moda_interact_registered_styles'][] = $handle;
}

function wp_enqueue_script( $handle ) {
	$GLOBALS['moda_interact_enqueued_scripts'][] = $handle;
}

function wp_enqueue_style( $handle ) {
	$GLOBALS['moda_interact_enqueued_styles'][] = $handle;
}

function wp_remote_request( ...$args ) {
	$GLOBALS['moda_interact_external_requests'][] = $args;
}

function delete_option( $option ) {
	$GLOBALS['moda_interact_deleted_options'][] = $option;
	unset( $GLOBALS['moda_interact_options'][ $option ], $GLOBALS['moda_interact_option_autoload'][ $option ] );
	return true;
}

function get_locale() {
	return $GLOBALS['moda_interact_store_locale'];
}

function get_user_locale() {
	return $GLOBALS['moda_interact_admin_locale'] ?? $GLOBALS['moda_interact_store_locale'];
}

function wc_get_base_location() {
	return $GLOBALS['moda_interact_base_location'];
}

function get_option( $option, $default = false ) {
	return $GLOBALS['moda_interact_options'][ $option ] ?? $default;
}

function add_option( $option, $value, $deprecated = '', $autoload = null ) {
	if ( $GLOBALS['moda_interact_fail_option_writes'] ) {
		return false;
	}
	if ( array_key_exists( $option, $GLOBALS['moda_interact_options'] ) ) {
		return false;
	}
	$GLOBALS['moda_interact_options'][ $option ] = $value;
	$GLOBALS['moda_interact_option_autoload'][ $option ] = false === $autoload || 'no' === $autoload ? false : true;
	return true;
}

function update_option( $option, $value, $autoload = null ) {
	if ( $GLOBALS['moda_interact_fail_option_writes'] ) {
		return false;
	}
	if ( ! array_key_exists( $option, $GLOBALS['moda_interact_options'] ) ) {
		return add_option( $option, $value, '', $autoload );
	}
	if ( $GLOBALS['moda_interact_options'][ $option ] === $value ) {
		return false;
	}
	$GLOBALS['moda_interact_options'][ $option ] = $value;
	if ( null !== $autoload ) {
		$GLOBALS['moda_interact_option_autoload'][ $option ] = false === $autoload || 'no' === $autoload ? false : true;
	}
	return true;
}

function set_transient( $transient, $value, $expiration = 0 ) {
	$GLOBALS['moda_interact_transients'][ $transient ] = array( 'value' => $value, 'expires' => time() + (int) $expiration );
	return true;
}

function get_transient( $transient ) {
	$item = $GLOBALS['moda_interact_transients'][ $transient ] ?? null;
	if ( ! is_array( $item ) || $item['expires'] <= time() ) {
		unset( $GLOBALS['moda_interact_transients'][ $transient ] );
		return false;
	}
	return $item['value'];
}

function delete_transient( $transient ) {
	$exists = array_key_exists( $transient, $GLOBALS['moda_interact_transients'] );
	unset( $GLOBALS['moda_interact_transients'][ $transient ] );
	return $exists;
}

function wp_next_scheduled( $hook, $args = array() ) {
	return false;
}

function wp_schedule_single_event( $timestamp, $hook, $args = array() ) {
	$GLOBALS['moda_interact_scheduled_events'][] = array( $timestamp, $hook, $args );
	return true;
}

function wp_json_encode( $value, $flags = 0, $depth = 512 ) {
	return json_encode( $value, $flags, $depth );
}

function wp_remote_retrieve_response_code( $response ) {
	return $response['response']['code'] ?? 0;
}

function wp_remote_retrieve_header( $response, $header ) {
	foreach ( $response['headers'] ?? array() as $name => $value ) {
		if ( strtolower( (string) $name ) === strtolower( $header ) ) {
			return $value;
		}
	}
	return '';
}

function wp_remote_retrieve_body( $response ) {
	return $response['body'] ?? '';
}

if ( ! class_exists( 'WP_REST_Request' ) ) {
	class WP_REST_Request {
		public function __construct(
			private string $method = 'GET',
			private array $query = array(),
			private array|null $json = null,
			private array $body = array()
		) {
		}

		public function get_query_params(): array { return $this->query; }
		public function get_json_params(): ?array { return $this->json; }
		public function get_body_params(): array { return $this->body; }
		public function get_method(): string { return $this->method; }
	}
}

if ( ! class_exists( 'WP_REST_Response' ) ) {
	class WP_REST_Response {
		private array $headers = array();
		public function __construct( private mixed $data = null, private int $status = 200 ) {}
		public function get_data(): mixed { return $this->data; }
		public function get_status(): int { return $this->status; }
		public function header( string $name, string $value ): void { $this->headers[ $name ] = $value; }
		public function get_headers(): array { return $this->headers; }
	}
}

if ( ! class_exists( 'WP_Error' ) ) {
	class WP_Error {
		public function __construct( private string $code = '', private string $message = '', private array $data = array() ) {}
		public function get_error_code(): string { return $this->code; }
		public function get_error_data(): array { return $this->data; }
	}
}

class WooCommerce {}

require_once dirname( __DIR__ ) . '/vendor/autoload.php';
require_once dirname( __DIR__ ) . '/moda-interact.php';
$GLOBALS['moda_interact_initial_hooks'] = $GLOBALS['moda_interact_test_hooks'];