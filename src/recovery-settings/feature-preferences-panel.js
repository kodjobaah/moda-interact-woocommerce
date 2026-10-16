import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

const messageFor = (status) => {
	switch (status) {
		case 'UNAVAILABLE':
			return __(
				'Feature preferences are not yet available for this WooCommerce store. No feature settings have been changed.',
				'moda-interact'
			);
		case 'DENIED':
			return __(
				'You do not have permission to view these feature settings.',
				'moda-interact'
			);
		case 'CONFLICT':
			return __(
				'Feature settings changed elsewhere. Refresh to review the latest settings.',
				'moda-interact'
			);
		default:
			return __(
				'Feature settings could not be loaded or saved. Refresh to retry.',
				'moda-interact'
			);
	}
};

function FeatureCard({ feature, busy, onToggle }) {
	const enabled = feature.editable ? feature.enabled : feature.effective;
	const copy = createElement(
		'span',
		{ className: 'moda-interact-features__copy' },
		createElement('strong', null, feature.name),
		feature.description ? createElement('p', null, feature.description) : null,
		createElement(
		'small',
		 null,
		feature.editable
			? __('Optional', 'moda-interact')
			: __('Always enabled', 'moda-interact'),
		' · ',
		enabled
			? __('Currently enabled', 'moda-interact')
			: __('Currently disabled', 'moda-interact')
		)
	);
	const className = `moda-interact-features__card${enabled ? ' is-selected' : ''}${feature.editable ? '' : ' is-core'}`;
	if (!feature.editable) {
		return createElement(
			'div',
			{ key: feature.id, className },
			createElement('span', {
				className: 'moda-interact-features__core-icon',
				'aria-hidden': true,
			}, enabled ? '✓' : '–'),
			copy
		);
	}
	return createElement(
		'label',
		{ key: feature.id, className },
		createElement('input', {
			type: 'checkbox',
			checked: enabled,
			disabled: busy,
			onChange: (event) => onToggle(feature.id, event.target.checked),
		}),
		createElement('span', { className: 'moda-interact-features__switch', 'aria-hidden': true },
			createElement('span', null)),
		copy
	);
}

/** Shopify-aligned view, with no fabricated catalogue or plan entitlements. */
export function FeaturePreferencesPanel({ state, onRefresh, onToggle }) {
	const status = state?.status ?? 'IDLE';
	const busy = status === 'LOADING' || status === 'SAVING';
	const features = state?.data?.features ?? [];
	const showFeatures = ['READY', 'SAVED', 'SAVING'].includes(status);
	const unavailable = ['ERROR', 'CONFLICT', 'DENIED', 'UNAVAILABLE'].includes(status);
	return createElement(
		'section',
		{
			id: 'conversation-features',
			className: 'moda-interact-recovery__panel moda-interact-features',
			'aria-labelledby': 'moda-interact-features-title',
			'aria-busy': busy,
		},
		createElement(
			'div',
			{ className: 'moda-interact-features__heading' },
			createElement('h2', { id: 'moda-interact-features-title' },
				__('Conversation features', 'moda-interact')),
			createElement('p', null,
				__('Core conversation features are always enabled. You can switch optional features on or off; changes apply to new conversations only.', 'moda-interact'))
		),
		busy
			? createElement('p', { role: 'status', className: 'moda-interact-features__status' },
				status === 'SAVING'
					? __('Saving…', 'moda-interact')
					: __('Loading…', 'moda-interact'))
			: null,
		unavailable
			? createElement('p', {
				role: status === 'UNAVAILABLE' ? 'status' : 'alert',
				className: 'moda-interact-features__status',
			}, messageFor(status))
			: null,
		showFeatures && !features.length
			? createElement('p', { role: 'status', className: 'moda-interact-features__status' },
				__('No eligible features are available on your current plan.', 'moda-interact'))
			: null,
		showFeatures && features.length
			? createElement('div', { className: 'moda-interact-features__grid' },
				features.map((feature) => FeatureCard({ feature, busy, onToggle })))
			: null,
		// Shopify has no permanent refresh button under a loaded feature grid.
		// Retain recovery for rejected/unavailable requests without obscuring the cards.
		unavailable
			? createElement('button', {
				type: 'button', className: 'button moda-interact-features__refresh',
				onClick: onRefresh,
			}, __('Refresh features', 'moda-interact'))
			: null
	);
}
