import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

const options = [
	{ mode: 'NONE', label: 'Do not offer a discount' },
	{ mode: 'FIXED', label: 'Specific discount' },
	{ mode: 'AI_BEST_APPLICABLE', label: 'AI-selected applicable discount' },
];

/**
 * Provider-neutral choice cards. All choices remain read-only until the
 * hosted WooCommerce policy/coupon contracts have been approved.
 *
 * @param {Object}      root0
 * @param {string|null} root0.activeMode
 */
export function RecoveryOfferChoices({ activeMode }) {
	const labels = {
		NONE: __('Do not offer a discount', 'moda-interact'),
		FIXED: __('Specific discount', 'moda-interact'),
		AI_BEST_APPLICABLE: __(
			'AI-selected applicable discount',
			'moda-interact'
		),
	};
	return createElement(
		'fieldset',
		{
			className: 'moda-recovery-behaviour__offers',
			'aria-describedby': 'woo-recovery-offer-help',
		},
		createElement(
			'legend',
			{ className: 'screen-reader-text' },
			__('Recovery offer', 'moda-interact')
		),
		...options.map(({ mode }) =>
			createElement(
				'label',
				{
					key: mode,
					className: `moda-recovery-behaviour__offer${activeMode === mode ? ' is-active' : ''}`,
				},
				createElement('input', {
					type: 'radio',
					name: 'wooRecoveryOfferPreview',
					value: mode,
					checked: activeMode === mode,
					disabled: true,
					readOnly: true,
				}),
				createElement('strong', null, labels[mode]),
				mode !== 'NONE'
					? createElement(
							'small',
							{
								className:
									'moda-recovery-behaviour__unavailable',
							},
							__('Unavailable', 'moda-interact')
						)
					: null
			)
		),
		createElement(
			'p',
			{
				id: 'woo-recovery-offer-help',
				className: 'moda-recovery-behaviour__hint',
			},
			__(
				'WooCommerce coupon selection is not yet available.',
				'moda-interact'
			)
		)
	);
}
