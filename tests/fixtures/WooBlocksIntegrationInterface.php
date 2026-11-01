<?php

namespace Automattic\WooCommerce\Blocks\Integrations;

interface IntegrationInterface {
	public function get_name(): string;
	public function initialize(): void;
	public function get_script_handles(): array;
	public function get_editor_script_handles(): array;
	public function get_script_data(): array;
}
