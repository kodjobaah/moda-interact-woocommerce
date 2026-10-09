import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

/** Presentation-only heading shared by native and legacy Recovery Settings pages. */
export function RecoverySettingsHeader() {
	return createElement(
		'header',
		{ className: 'moda-interact-recovery__hero' },
		createElement(
			'span',
			{ className: 'moda-interact-recovery__eyebrow' },
			__('Store & assistant context', 'moda-interact')
		),
		createElement(
			'h2',
			{ id: 'moda-interact-recovery-heading' },
			__('Recovery Settings', 'moda-interact')
		),
		createElement(
			'p',
			null,
			__(
				'Choose the type of store to personalize your CommerceAgent assistant. Your Free plan stays active.',
				'moda-interact'
			)
		)
	);
}
