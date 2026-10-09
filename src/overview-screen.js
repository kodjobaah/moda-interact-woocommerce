import { dateI18n, getSettings } from '@wordpress/date';
import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

function formatAdminDate(value) {
	const formats = getSettings().formats;
	const format =
		formats.datetime ||
		`${formats.date || 'Y-m-d'} ${formats.time || 'H:i'}`;
	return dateI18n(format, value);
}

function dataRow(label, value) {
	return [
		createElement('dt', { key: `${label}-label` }, label),
		createElement('dd', { key: `${label}-value` }, value),
	];
}

function categoryDetails(category) {
	if (!category) {
		return createElement(
			'p',
			{ className: 'moda-interact-overview__empty' },
			__('Not selected', 'moda-interact')
		);
	}

	return createElement(
		'dl',
		{ className: 'moda-interact-details' },
		...dataRow(__('Name', 'moda-interact'), category.displayName),
		...dataRow(__('Category ID', 'moda-interact'), category.id),
		...dataRow(__('Slug', 'moda-interact'), category.slug)
	);
}

function OverviewCard({ title, children }) {
	return createElement(
		'section',
		{ className: 'moda-interact-overview-card' },
		createElement('h3', null, title),
		children
	);
}

function OverviewContent({ data }) {
	const { shop, internationalContext, storeProfile } = data;
	const notAvailable = __('Not available', 'moda-interact');
	const pendingSelectedAt = storeProfile.pendingSelectedAt
		? formatAdminDate(storeProfile.pendingSelectedAt)
		: notAvailable;

	return createElement(
		'div',
		{ className: 'moda-interact-overview-grid' },
		createElement(
			OverviewCard,
			{ title: __('Account setup', 'moda-interact') },
			createElement(
				'dl',
				{ className: 'moda-interact-details' },
				...dataRow(
					__('Setup status', 'moda-interact'),
					shop.onboardingCompleted
						? __('Setup completed', 'moda-interact')
						: __('Setup not completed', 'moda-interact')
				),
				...dataRow(__('Store', 'moda-interact'), shop.domain),
				...dataRow(
					__('Store added', 'moda-interact'),
					formatAdminDate(shop.installedAt)
				)
			)
		),
		createElement(
			OverviewCard,
			{ title: __('Store profile', 'moda-interact') },
			createElement(
				'div',
				{ className: 'moda-interact-overview__category' },
				createElement(
					'h4',
					null,
					__('Active category', 'moda-interact')
				),
				categoryDetails(storeProfile.activeCategory)
			),
			createElement(
				'div',
				{ className: 'moda-interact-overview__category' },
				createElement(
					'h4',
					null,
					__('Pending category', 'moda-interact')
				),
				categoryDetails(storeProfile.pendingCategory)
			),
			createElement(
				'dl',
				{ className: 'moda-interact-details' },
				...dataRow(
					__('Selection generation', 'moda-interact'),
					String(storeProfile.pendingSelectionGeneration)
				),
				...dataRow(
					__('Pending selection date', 'moda-interact'),
					pendingSelectedAt
				)
			)
		),
		createElement(
			OverviewCard,
			{ title: __('Store context', 'moda-interact') },
			createElement(
				'dl',
				{ className: 'moda-interact-details' },
				...dataRow(
					__('Store locale', 'moda-interact'),
					internationalContext.storeLocale ?? notAvailable
				),
				...dataRow(
					__('Language tag', 'moda-interact'),
					internationalContext.languageTag ?? notAvailable
				),
				...dataRow(
					__('Time zone', 'moda-interact'),
					internationalContext.timeZone ?? notAvailable
				),
				...dataRow(
					__('Country code', 'moda-interact'),
					internationalContext.countryCode ?? notAvailable
				)
			)
		)
	);
}

export function OverviewScreen({
	state,
	onRefresh,
	syncState = { status: 'IDLE' },
	onSync,
}) {
	let content;
	switch (state.status) {
		case 'IDLE':
		case 'LOADING':
			content = createElement(
				'p',
				{ className: 'moda-interact-message', role: 'status' },
				__('Loading store overview…', 'moda-interact')
			);
			break;
		case 'READY':
			content = createElement(OverviewContent, { data: state.data });
			break;
		case 'RECONNECT_REQUIRED':
			content = createElement(
				'p',
				{ className: 'moda-interact-message', role: 'alert' },
				__(
					'The Moda Interact connection needs attention before store data can be loaded.',
					'moda-interact'
				)
			);
			break;
		case 'REMOTE_UNAVAILABLE':
			content = createElement(
				'p',
				{ className: 'moda-interact-message', role: 'alert' },
				__(
					'The store overview is temporarily unavailable. Your connection and store data have not been changed.',
					'moda-interact'
				)
			);
			break;
		default:
			content = createElement(
				'p',
				{ className: 'moda-interact-message', role: 'alert' },
				__(
					'The store overview could not be verified. Try again.',
					'moda-interact'
				)
			);
	}

	return createElement(
		'section',
		{
			className: 'moda-interact-overview',
			'aria-labelledby': 'moda-interact-overview-heading',
			'aria-busy': state.status === 'LOADING',
		},
		createElement(
			'div',
			{ className: 'moda-interact-overview__heading' },
			createElement(
				'h2',
				{ id: 'moda-interact-overview-heading' },
				__('Overview', 'moda-interact')
			),
			createElement(
				'div',
				{ className: 'moda-interact-overview__actions' },
				createElement(
					'button',
					{
						type: 'button',
						className: 'button',
						disabled: syncState.status === 'SYNCING',
						onClick: onSync,
					},
					syncState.status === 'SYNCING'
						? __('Syncing…', 'moda-interact')
						: __('Sync store settings', 'moda-interact')
				),
				createElement(
					'button',
					{
						type: 'button',
						className: 'button',
						disabled: state.status === 'LOADING',
						onClick: onRefresh,
					},
					state.status === 'LOADING'
						? __('Refreshing…', 'moda-interact')
						: __('Refresh overview', 'moda-interact')
				)
			)
		),
		syncState.status === 'ERROR'
			? createElement(
					'p',
					{
						className:
							'moda-interact-message moda-interact-message--error',
						role: 'alert',
					},
					__(
						'Store settings could not be synchronized. Your connection is unchanged. Please retry.',
						'moda-interact'
					)
				)
			: null,
		syncState.status === 'SYNCED'
			? createElement(
					'p',
					{ className: 'moda-interact-message', role: 'status' },
					__('Store settings synchronized.', 'moda-interact')
				)
			: null,
		content
	);
}

export { OverviewContent };
