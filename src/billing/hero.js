import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { BillingHubCapacity } from './hub-capacity';

const VIEWS = [
	['TOP_UPS', __('Add top-up', 'moda-interact')],
	['PLANS', __('Change plan', 'moda-interact')],
];

export function BillingHero({ state, onRefresh, onSetView }) {
	const ready = state.status === 'READY';
	return createElement(
		'div',
		{ className: 'moda-interact-billing-hub' },
		createElement(
			'div',
			{ className: 'moda-interact-billing-hub__topbar' },
			createElement(
				'p',
				{ className: 'moda-interact-billing-hub__page-title' },
				__('Billing', 'moda-interact'),
				' & ',
				__('Recovery capacity', 'moda-interact')
			),
			createElement(
				'div',
				{ className: 'moda-interact-billing-hub__toolbar' },
				ready && state.data?.surfaces?.usageHistoryAllowed
					? createElement(
							'a',
							{
								href: 'admin.php?page=moda-interact-usage-history',
								className:
									'button moda-interact-billing-hub__history',
							},
							__('Usage history', 'moda-interact')
						)
					: null,
				createElement(
					'button',
					{
						type: 'button',
						className: 'button moda-interact-billing-hub__refresh',
						disabled: state.status === 'LOADING',
						onClick: onRefresh,
					},
					__('Refresh billing', 'moda-interact')
				)
			)
		),
		createElement(
			'div',
			{ className: 'moda-interact-billing-hub__hero' },
			createElement(
				'div',
				{ className: 'moda-interact-billing-hub__copy' },
				createElement(
					'p',
					{ className: 'moda-interact-billing-hub__eyebrow' },
					__('Recovery capacity', 'moda-interact')
				),
				createElement(
					'h2',
					{ id: 'moda-interact-billing-heading' },
					__(
						'Add more conversations or change your plan.',
						'moda-interact'
					)
				),
				createElement(
					'div',
					{ className: 'moda-interact-billing-hub__actions' },
					...VIEWS.map(([view, label]) =>
						createElement(
							'button',
							{
								key: view,
								type: 'button',
								className:
									view === state.view
										? 'button moda-interact-billing-hub__action is-active'
										: 'button moda-interact-billing-hub__action',
								disabled:
									!ready ||
									(view === 'PLANS' &&
										!state.data?.surfaces
											.managePlansAllowed),
								onClick: () => onSetView(view),
							},
							label
						)
					)
				)
			),
			ready
				? createElement(BillingHubCapacity, {
						data: state.data,
						state,
						onSetView,
					})
				: null
		)
	);
}

/**
 * Ordinary buttons, not ARIA tabs: no misleading arrow-key tab contract.
 * @param {Object}                 root0           - View switch properties.
 * @param {Object}                 root0.state     - Billing state.
 * @param {(view: string) => void} root0.onSetView - Select a view.
 */
export function BillingViewSwitch({ state, onSetView }) {
	if (state.status !== 'READY') {
		return null;
	}
	return createElement(
		'nav',
		{
			className: 'moda-interact-billing-hub__switch',
			'aria-label': __('Billing', 'moda-interact'),
		},
		...VIEWS.map(([view, label]) =>
			createElement(
				'button',
				{
					key: view,
					type: 'button',
					className: state.view === view ? 'is-active' : '',
					'aria-pressed': state.view === view,
					disabled:
						view === 'PLANS' &&
						!state.data?.surfaces.managePlansAllowed,
					onClick: () => onSetView(view),
				},
				label
			)
		)
	);
}
