import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

export function BillingHero({ state, onRefresh, onSetView }) {
	return createElement(
		'header',
		{ className: 'moda-interact-billing__heading' },
		createElement(
			'div',
			{ className: 'moda-interact-billing__hero-copy' },
			createElement(
				'h2',
				{ id: 'moda-interact-billing-heading' },
				__('Billing', 'moda-interact')
			),
			state.status === 'READY' && state.data.currentPlan
				? createElement(
						'p',
						{ className: 'moda-interact-billing__hero-plan' },
						createElement(
							'span',
							null,
							__('Current plan', 'moda-interact')
						),
						' ',
						state.data.currentPlan.displayName
					)
				: null,
			createElement(
				'div',
				{
					className: 'moda-interact-billing__tabs',
					role: 'tablist',
					'aria-label': __('Billing', 'moda-interact'),
				},
				...[
					['SUMMARY', __('Summary', 'moda-interact')],
					['PLANS', __('Plans', 'moda-interact')],
				].map(([view, label]) =>
					createElement(
						'button',
						{
							key: view,
							type: 'button',
							role: 'tab',
							'aria-selected': state.view === view,
							className:
								view === state.view
									? 'button moda-interact-billing__tab is-active'
									: 'button moda-interact-billing__tab',
							disabled:
								view === 'PLANS' &&
								state.status === 'READY' &&
								!state.data.surfaces.managePlansAllowed,
							onClick: () => onSetView(view),
						},
						label
					)
				)
			)
		),
		createElement(
			'button',
			{
				type: 'button',
				className: 'button moda-interact-billing__refresh',
				disabled: state.status === 'LOADING',
				onClick: onRefresh,
			},
			__('Refresh billing', 'moda-interact')
		)
	);
}
