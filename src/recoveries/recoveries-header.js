import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

export function RecoveriesHeader({ onRefresh, disabled = false }) {
	return createElement(
		'header',
		{ className: 'moda-recoveries__header' },
		createElement(
			'div',
			null,
			createElement(
				'h1',
				{ id: 'moda-recoveries-heading' },
				__('Recoveries', 'moda-interact')
			),
			createElement(
				'p',
				null,
				__(
					'Browse recovery attempts and their latest outcomes.',
					'moda-interact'
				)
			)
		),
		createElement(
			'button',
			{
				type: 'button',
				className: 'button moda-recoveries__refresh',
				disabled: disabled || !onRefresh,
				onClick: onRefresh,
			},
			__('Refresh', 'moda-interact')
		)
	);
}
