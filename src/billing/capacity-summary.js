import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { formatQuantity } from './presentation-formatters';

export function CapacitySummary({
	data,
	frozen,
	format = formatQuantity,
	locale,
}) {
	const metrics = [
		...(data.capacity.paidIncluded
			? [
					[
						'paid',
						__('Paid included credits remaining', 'moda-interact'),
						frozen
							? __('Temporarily unavailable', 'moda-interact')
							: format(
									data.capacity.paidIncluded.remaining,
									locale
								),
					],
				]
			: []),
		[
			'free',
			__('Lifetime Free credits remaining', 'moda-interact'),
			format(data.capacity.freeLifetime.remaining, locale),
		],
		[
			'promotional',
			__('Promotional credits remaining', 'moda-interact'),
			format(data.capacity.promotional.remaining, locale),
		],
		[
			'purchased',
			__('Purchased credits available', 'moda-interact'),
			format(data.capacity.purchased.available, locale),
		],
	];

	return createElement(
		'section',
		{
			className:
				'moda-interact-billing-card moda-interact-billing-card--capacity',
		},
		createElement('h3', null, __('Recovery capacity', 'moda-interact')),
		createElement(
			'div',
			{ className: 'moda-interact-capacity-grid' },
			...metrics.map(([key, label, value]) =>
				createElement(
					'div',
					{
						className: `moda-interact-capacity moda-interact-capacity--${key}`,
						key,
					},
					createElement('span', null, label),
					createElement('strong', null, value)
				)
			)
		)
	);
}
