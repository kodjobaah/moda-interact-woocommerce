import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { DetailSectionState } from '../states/detail-section-state';
import { RecoveryStatusBadge } from '../../list/recovery-status-badge';

/**
 * Independent paginated related-recoveries section, initially disconnected.
 * @param {Object}                             root0
 * @param {string}                             root0.state
 * @param {Array<Object>}                      root0.items
 * @param {boolean}                            root0.hasPrevious
 * @param {boolean}                            root0.hasNext
 * @param {(() => void)|undefined}             root0.onPrevious
 * @param {(() => void)|undefined}             root0.onNext
 * @param {(() => void)|undefined}             root0.onRefresh
 * @param {((id: string) => string)|undefined} root0.getHref
 */
export function RelatedRecoveries({
	state = 'UNAVAILABLE',
	items = [],
	hasPrevious = false,
	hasNext = false,
	onPrevious,
	onNext,
	onRefresh,
	getHref,
}) {
	const busy = state === 'LOADING';
	return createElement(
		'section',
		{
			className: 'moda-recovery-detail__related',
			'aria-labelledby': 'moda-recovery-related-title',
			'aria-busy': busy,
		},
		createElement(
			'div',
			{ className: 'moda-recovery-detail__related-actions' },
			createElement(
				'button',
				{
					type: 'button',
					className: 'button',
					disabled: busy || !onRefresh,
					onClick: onRefresh,
				},
				__('Refresh', 'moda-interact')
			)
		),
		state === 'READY' && items.length
			? createElement(
					'ul',
					{ className: 'moda-recovery-detail__related-list' },
					...items.map((item) =>
						createElement(
							'li',
							{ key: item.id },
							getHref?.(item.id)
								? createElement(
										'a',
										{ href: getHref(item.id) },
										item.label
									)
								: createElement('span', null, item.label),
							createElement(
								'p',
								null,
								item.status
									? createElement(RecoveryStatusBadge, {
											status: item.status,
										})
									: null,
								item.checkoutValue
									? ` · ${item.checkoutValue}`
									: ''
							)
						)
					)
				)
			: createElement(DetailSectionState, {
					state: state === 'READY' ? 'EMPTY' : state,
					emptyMessage: __('No related recoveries.', 'moda-interact'),
				}),
		createElement(
			'nav',
			{
				className: 'moda-recovery-detail__paging',
				'aria-label': __('Related recoveries', 'moda-interact'),
			},
			createElement(
				'button',
				{
					type: 'button',
					className: 'button',
					disabled: busy || !hasPrevious || !onPrevious,
					onClick: onPrevious,
				},
				__('Previous', 'moda-interact')
			),
			createElement(
				'button',
				{
					type: 'button',
					className: 'button',
					disabled: busy || !hasNext || !onNext,
					onClick: onNext,
				},
				__('Next', 'moda-interact')
			)
		)
	);
}
