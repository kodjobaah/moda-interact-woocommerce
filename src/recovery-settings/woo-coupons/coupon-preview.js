import { createElement, useEffect, useRef, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { createCouponPreviewClient } from './coupon-client';
import { CouponPreviewList } from './coupon-list';

/** WooCommerce-local discovery only; neither React nor PHP persist the selected ID. */
export function CouponCataloguePreview() {
	const client = useRef(createCouponPreviewClient());
	const generation = useRef(0);
	const [active, setActive] = useState(false);
	const [search, setSearch] = useState('');
	const [applied, setApplied] = useState('');
	const [page, setPage] = useState(1);
	const [state, setState] = useState({ status: 'IDLE', data: null });
	const [selectedId, setSelectedId] = useState(null);

	useEffect(() => {
		if (!active) {
			return undefined;
		}
		const revision = ++generation.current;
		setState({ status: 'LOADING', data: null });
		client.current
			.read({ page, q: applied })
			.then((data) => {
				if (generation.current === revision) {
					setState({ status: 'READY', data });
				}
			})
			.catch(() => {
				if (generation.current === revision) {
					setState({ status: 'ERROR', data: null });
				}
			});
		return () => {
			generation.current += 1;
		};
	}, [active, applied, page]);

	const data = state.data;
	return createElement(
		'details',
		{
			className: 'moda-coupon-preview',
			onToggle: (event) => {
				setActive(event.currentTarget.open);
				if (!event.currentTarget.open) {
					setSelectedId(null);
				}
			},
		},
		createElement('summary', null, __('Browse coupons', 'moda-interact')),
		createElement(
			'p',
			{ className: 'moda-coupon-preview__warning', role: 'note' },
			__(
				'Preview only. Coupon choices are not saved or used in recovery messages.',
				'moda-interact'
			)
		),
		createElement(
			'form',
			{
				className: 'moda-coupon-preview__filters',
				onSubmit: (event) => {
					event.preventDefault();
					setSelectedId(null);
					setPage(1);
					setApplied(search.trim());
				},
			},
			createElement(
				'label',
				null,
				__('Search coupons', 'moda-interact'),
				createElement('input', {
					type: 'search',
					value: search,
					maxLength: 80,
					onChange: (event) => setSearch(event.currentTarget.value),
				})
			),
			createElement(
				'button',
				{ type: 'submit', className: 'button' },
				__('Search', 'moda-interact')
			)
		),
		state.status === 'LOADING'
			? createElement(
					'p',
					{ role: 'status' },
					__('Loading…', 'moda-interact')
				)
			: null,
		state.status === 'ERROR'
			? createElement(
					'p',
					{ role: 'alert' },
					__('Coupons could not be loaded.', 'moda-interact')
				)
			: null,
		state.status === 'READY' && data.items.length === 0
			? createElement(
					'p',
					{ role: 'status' },
					__('No coupons found.', 'moda-interact')
				)
			: null,
		state.status === 'READY' && data.items.length > 0
			? createElement(CouponPreviewList, {
					items: data.items,
					selectedId,
					onSelect: setSelectedId,
				})
			: null,
		state.status === 'READY'
			? createElement(
					'nav',
					{
						className: 'moda-coupon-preview__pagination',
						'aria-label': __('Browse coupons', 'moda-interact'),
					},
					createElement(
						'button',
						{
							type: 'button',
							className: 'button',
							disabled: page <= 1,
							onClick: () => {
								setSelectedId(null);
								setPage((value) => Math.max(1, value - 1));
							},
						},
						__('Previous', 'moda-interact')
					),
					createElement(
						'span',
						null,
						sprintf(
							/* translators: 1: Current coupon catalogue page; 2: Total number of catalogue pages. */
							__('Page %1$s of %2$s', 'moda-interact'),
							String(data.page),
							String(data.totalPages)
						)
					),
					createElement(
						'button',
						{
							type: 'button',
							className: 'button',
							disabled: page >= data.totalPages,
							onClick: () => {
								setSelectedId(null);
								setPage((value) => value + 1);
							},
						},
						__('Next', 'moda-interact')
					)
				)
			: null
	);
}
