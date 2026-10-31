<?php

use ModaInteract\WooCommerce\Checkout\CheckoutActivityPublisher;
use ModaInteract\WooCommerce\Checkout\CheckoutCapture;
use ModaInteract\WooCommerce\Checkout\CheckoutCartRestorer;
use ModaInteract\WooCommerce\Checkout\CheckoutResumeController;
use PHPUnit\Framework\TestCase;

if ( ! function_exists( 'WC' ) ) { function WC() { return $GLOBALS['arch035_wc'] ?? null; } }

final class ResumeControllerSession {
	public array $values = array();
	public bool $cookie_set = false;
	public function get( string $key ): mixed { return $this->values[ $key ] ?? null; }
	public function set( string $key, mixed $value ): void { $this->values[ $key ] = $value; }
	public function set_customer_session_cookie( bool $set ): void { $this->cookie_set = $set; }
}

final class CheckoutResumeControllerTest extends TestCase {
	private CheckoutResumeController $controller;
	private ResumeControllerSession $session;
	private int $resolve_count = 0;
	private mixed $previous_home_url;

	protected function setUp(): void {
		$this->previous_home_url = $GLOBALS['moda_interact_home_url'] ?? null;
		$GLOBALS['moda_interact_home_url'] = 'https://merchant.example/shop';
		$this->session = new ResumeControllerSession();
		$GLOBALS['arch035_wc'] = (object) array( 'session' => $this->session, 'cart' => new stdClass(), 'customer' => null );
		$capture = new CheckoutCapture( new CheckoutActivityPublisher() );
		$this->controller = new CheckoutResumeController( $capture, new CheckoutCartRestorer( $capture ), null,
			function (): array { ++$this->resolve_count; return array(); } );
	}

	protected function tearDown(): void {
		$GLOBALS['moda_interact_home_url'] = $this->previous_home_url;
		parent::tearDown();
	}

	public function test_get_and_head_are_read_only_excluding_bounded_visitor_confirmation_evidence(): void {
		$query = array( 'moda_interact_resume' => '1', 'r' => 'recovery_456', 't' => str_repeat( 'A', 43 ) );
		$head = $this->controller->handleRequest( 'HEAD', '/shop/', $query, array(), array() );
		self::assertSame( '', $head['body'] );
		self::assertSame( 'no-store', $head['headers']['Cache-Control'] );
		self::assertSame( 'no-referrer', $head['headers']['Referrer-Policy'] );
		self::assertSame( array(), $this->session->values );
		$get = $this->controller->handleRequest( 'GET', '/shop/', $query, array(), array() );
		self::assertSame( 200, $get['status'] );
		self::assertSame( 'text/html; charset=utf-8', $get['headers']['Content-Type'] );
		self::assertStringContainsString( 'Replace current basket and continue', $get['body'] );
		self::assertStringContainsString( str_repeat( 'A', 43 ), $get['body'] );
		self::assertStringNotContainsString( 'woo-example-checkout', $get['body'] );
		self::assertStringNotContainsString( '<script', $get['body'] );
		self::assertTrue( $this->session->cookie_set );
		self::assertIsArray( $this->session->get( 'moda_interact_restore_nonce_v1' ) );
		self::assertSame( 0, $this->resolve_count );
	}

	public function test_link_is_bound_to_merchant_home_subpath_and_forged_post_never_resolves(): void {
		self::assertNull( $this->controller->handleRequest( 'GET', '/shop/child/', array(
			'moda_interact_resume' => '1', 'r' => 'recovery_456', 't' => str_repeat( 'A', 43 ),
		), array(), array() ) );
		$body = array( 'moda_interact_resume' => '1', 'r' => 'recovery_456', 't' => str_repeat( 'A', 43 ),
			'nonce' => str_repeat( 'B', 43 ), 'confirm' => 'replace' );
		$response = $this->controller->handleRequest( 'POST', '/shop/', array(), $body, array(
			'HTTP_ORIGIN' => 'https://attacker.example', 'CONTENT_LENGTH' => '250',
		) );
		self::assertSame( 'https://merchant.example/shop', $response['redirect'] );
		self::assertSame( 0, $this->resolve_count );
	}

	public function test_malformed_get_redirects_without_error_marker_or_error_html(): void {
		$response = $this->controller->handleRequest( 'GET', '/shop/', array(
			'moda_interact_resume' => '1', 'r' => 'not valid', 't' => 'short',
		), array(), array() );
		self::assertArrayHasKey( 'redirect', $response );
		self::assertStringNotContainsString( 'error', $response['redirect'] );
		self::assertSame( '', $response['body'] );
		self::assertSame( 0, $this->resolve_count );
	}
}