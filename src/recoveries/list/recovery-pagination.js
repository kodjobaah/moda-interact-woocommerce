import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

export function RecoveryPagination({
	hasPrevious = false,
	hasNext = false,
	onPrevious,
	onNext,
}) {
	return createElement(
		'nav',
		{
			className: 'moda-recoveries__pagination',
			'aria-label': __('Recovery pages', 'moda-interact'),
		},
		createElement(
			'button',
			{
				type: 'button',
				className: 'button-link',
				disabled: !hasPrevious || !onPrevious,
				onClick: onPrevious,
			},
			__('Previous', 'moda-interact')
		),
		createElement(
			'button',
			{
				type: 'button',
				className: 'button-link',
				disabled: !hasNext || !onNext,
				onClick: onNext,
			},
			__('Next', 'moda-interact')
		)
	);
}
