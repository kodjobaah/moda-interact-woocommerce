import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { RecoveryDetailHeader } from './recovery-detail-header';
import { ConversationPanel } from './conversation/conversation-panel';
import { CheckoutContextPanel } from './context/checkout-context-panel';

/**
 * Map the detail read state to the existing translated notice.
 *
 * @param {string|null} recoveryId - Recovery identifier, when valid.
 * @param {string}      status     - Detail read state.
 * @return {string} Translated notice.
 */
function unavailableDetailMessage(recoveryId, status) {
	if (recoveryId === null || status === 'NOT_FOUND') {
		return __('Recovery unavailable.', 'moda-interact');
	}
	if (status === 'LOADING') {
		return __('Loading recoveries…', 'moda-interact');
	}
	if (status === 'ERROR') {
		return __('This section could not be loaded.', 'moda-interact');
	}
	return __(
		'This section is not yet available for WooCommerce.',
		'moda-interact'
	);
}

/**
 * Render the read-only Recovery Detail screen using independently loaded sections.
 *
 * @param {Object}      root0              - Component props.
 * @param {Object}      root0.route        - Detail route and list-return URL.
 * @param {string}      root0.status       - Summary loading state.
 * @param {Object|null} root0.detail       - Formatted summary, when available.
 * @param {Object}      root0.conversation - Conversation presentation state.
 * @param {Object}      root0.related      - Related-recovery presentation state.
 * @return {Object} Recovery Detail element.
 */
export function RecoveryDetailScreen({
	route,
	status = 'UNAVAILABLE',
	detail = null,
	conversation = {},
	related = {},
}) {
	return createElement(
		'section',
		{
			className: 'moda-recovery-detail',
			'aria-labelledby': 'moda-recovery-detail-heading',
		},
		createElement(
			'a',
			{ className: 'moda-recovery-detail__back', href: route.listHref },
			__('Back to recoveries', 'moda-interact')
		),
		createElement(RecoveryDetailHeader, { detail }),
		!detail
			? createElement(
					'p',
					{
						className: 'moda-recovery-detail__unavailable',
						role: 'status',
					},
					unavailableDetailMessage(route.recoveryId, status)
				)
			: null,
		createElement(
			'div',
			{ className: 'moda-recovery-detail__layout' },
			createElement(ConversationPanel, conversation),
			createElement(CheckoutContextPanel, {
				milestones: detail?.milestones,
				related,
			})
		)
	);
}
