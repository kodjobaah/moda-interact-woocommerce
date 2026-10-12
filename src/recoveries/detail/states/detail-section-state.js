import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

/**
 * Distinguish unavailable connectivity from a verified empty conversation.
 * @param {Object} root0
 * @param {string} root0.state
 * @param {string} root0.emptyMessage
 */
export function DetailSectionState({ state, emptyMessage }) {
	let message = __(
		'This section is not yet available for WooCommerce.',
		'moda-interact'
	);
	if (state === 'LOADING') {
		message = __('Loading recoveries…', 'moda-interact');
	}
	if (state === 'ERROR') {
		message = __('This section could not be loaded.', 'moda-interact');
	}
	if (state === 'EMPTY') {
		message = emptyMessage;
	}
	return createElement(
		'p',
		{
			className: 'moda-recovery-detail__section-state',
			role: state === 'ERROR' ? 'alert' : 'status',
		},
		message
	);
}
