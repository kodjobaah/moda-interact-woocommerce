import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import {
	formatQuantity,
	resolveBillingLocale,
} from './presentation-formatters';

/** The read-only capacity snapshot stays visible across billing actions. */
export function BillingHubCapacity({ data, state, onSetView, locale = resolveBillingLocale() }) {
	if (!data?.capacity) {
		return null;
	}

	const { capacity } = data;
	const metrics = [
		...(capacity.paidIncluded ? [[
			'paid',
			__('Paid included credits remaining', 'moda-interact'),
			data.experienceState === 'FROZEN'
				? __('Temporarily unavailable', 'moda-interact')
				: formatQuantity(capacity.paidIncluded.remaining, locale),
		]] : []),
		...(capacity.freeLifetime ? [[
			'free',
			__('Lifetime Free credits remaining', 'moda-interact'),
			formatQuantity(capacity.freeLifetime.remaining, locale),
		]] : []),
		...(capacity.promotional ? [[
			'promotional',
			__('Promotional credits remaining', 'moda-interact'),
			formatQuantity(capacity.promotional.remaining, locale),
		]] : []),
		...(capacity.purchased ? [[
			'purchased',
			__('Purchased credits available', 'moda-interact'),
			formatQuantity(capacity.purchased.available, locale),
		]] : []),
	];

	return createElement(
		'aside',
		{
			className: 'moda-interact-billing-hub__capacity',
			'aria-label': __('Recovery capacity', 'moda-interact'),
		},
		createElement(
			'div',
			{ className: 'moda-interact-billing-hub__plan' },
			createElement('span', null, __('Current plan', 'moda-interact')),
			createElement(
				'strong',
				null,
				data.currentPlan?.displayName ?? __('Unavailable', 'moda-interact')
			)
		),
		createElement(
			'div',
			{ className: 'moda-interact-billing-hub__metrics' },
			...metrics.map(([key, label, value]) =>
				createElement(
					'div',
					{ key, className: 'moda-interact-billing-hub__metric' },
					createElement('strong', null, value),
					createElement('span', null, label)
				)
			)
		),
		createElement(
			'button',
			{
				type: 'button',
				className: 'moda-interact-billing-hub__details',
				'aria-pressed': state.view === 'SUMMARY',
				onClick: () => onSetView('SUMMARY'),
			},
			__('Summary', 'moda-interact')
		)
	);
}
