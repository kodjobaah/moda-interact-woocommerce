import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

const ModaInteractPage = () =>
	createElement(
		'main',
		{ className: 'moda-interact-page' },
		createElement('h1', null, __('Moda Interact', 'moda-interact')),
		createElement(
			'p',
			null,
			__('WooCommerce extension foundation', 'moda-interact')
		)
	);

export default ModaInteractPage;
