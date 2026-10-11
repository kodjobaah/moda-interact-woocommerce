import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

export function RecoveryResultsState({ state, onRetry, onClear }) {
	const messages = {
		UNAVAILABLE: () =>
			__('Recovery data is not connected.', 'moda-interact'),
		LOADING: () => __('Loading recoveries…', 'moda-interact'),
		NEVER_USED: () => __('No recoveries yet', 'moda-interact'),
		EMPTY: () => __('No matching recoveries', 'moda-interact'),
		ERROR: () => __('Recoveries could not be loaded.', 'moda-interact'),
	};

	return createElement(
		'div',
		{
			className: `moda-recoveries__state moda-recoveries__state--${state.toLowerCase()}`,
			role: state === 'ERROR' ? 'alert' : 'status',
		},
		createElement(
			'h3',
			null,
			messages[state]?.() ?? __('Unavailable', 'moda-interact')
		),
		state === 'UNAVAILABLE'
			? createElement(
					'p',
					null,
					__(
						'Recovery records will appear after the read API is connected.',
						'moda-interact'
					)
				)
			: null,
		state === 'NEVER_USED'
			? createElement(
					'p',
					null,
					__(
						'Recovery records will appear here when recovery starts.',
						'moda-interact'
					)
				)
			: null,
		state === 'EMPTY'
			? createElement(
					'p',
					null,
					__(
						'Try another date range, customer or status.',
						'moda-interact'
					)
				)
			: null,
		state === 'LOADING'
			? createElement('div', {
					className: 'moda-recoveries__skeleton',
					'aria-hidden': true,
				})
			: null,
		state === 'ERROR' && onRetry
			? createElement(
					'button',
					{ type: 'button', className: 'button', onClick: onRetry },
					__('Refresh', 'moda-interact')
				)
			: null,
		state === 'EMPTY' && onClear
			? createElement(
					'button',
					{
						type: 'button',
						className: 'button-link',
						onClick: onClear,
					},
					__('Clear filters', 'moda-interact')
				)
			: null
	);
}
