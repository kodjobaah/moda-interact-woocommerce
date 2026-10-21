import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

/**
 * Permanent Shopify-parity context card. Only the two child disclosures
 * expand/collapse; this container itself is not interactive.
 *
 * @param {Object} props Context children supplied by the parent screen.
 */
export function StoreAssistantContext(props) {
	const { storeProfile, merchantKnowledge } = props;
	return createElement(
		'section',
		{
			className:
				'moda-interact-recovery__panel moda-interact-store-context',
			'aria-labelledby': 'moda-interact-store-context-title',
		},
		createElement(
			'header',
			{ className: 'moda-interact-store-context__heading' },
			createElement(
				'h2',
				{ id: 'moda-interact-store-context-title' },
				__('Store & assistant context', 'moda-interact')
			),
			createElement(
				'p',
				null,
				__(
					'Store classification and reference material used by the assistant.',
					'moda-interact'
				)
			)
		),
		createElement(
			'div',
			{ className: 'moda-interact-store-context__items' },
			storeProfile,
			merchantKnowledge
		)
	);
}
