import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { RecoveryEffectiveSummary } from './recovery-effective-summary';

// Shopify-style hero with an independently loaded read-only summary.
export function RecoverySettingsHeader({ summaryState, onRefreshSummary }) {
	return createElement(
		'header',
		{ className: 'moda-interact-recovery__hero' },
		createElement(
			'div',
			{ className: 'moda-interact-recovery__hero-copy' },
			createElement(
				'span',
				{ className: 'moda-interact-recovery__eyebrow' },
				__('Recovery settings', 'moda-interact')
			),
			createElement(
				'h2',
				{ id: 'moda-interact-recovery-heading' },
				__('Recovery Settings', 'moda-interact')
			)
		),
		createElement(RecoveryEffectiveSummary, {
			state: summaryState,
			onRetry: onRefreshSummary,
		})
	);
}
