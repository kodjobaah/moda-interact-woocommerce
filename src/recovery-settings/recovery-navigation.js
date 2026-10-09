import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

export function RecoveryNavigation({ selected, onSelect }) {
	return createElement(
		'nav',
		{
			className: 'moda-interact-recovery-nav',
			'aria-label': __('Moda Interact sections', 'moda-interact'),
		},
		[
			{ key: 'overview', title: __('Overview', 'moda-interact') },
			{
				key: 'recovery',
				title: __('Recovery Settings', 'moda-interact'),
			},
		].map(({ key, title }) =>
			createElement(
				'button',
				{
					key,
					type: 'button',
					className:
						selected === key ? 'button button-primary' : 'button',
					'aria-current': selected === key ? 'page' : undefined,
					onClick: () => onSelect(key),
				},
				title
			)
		)
	);
}
