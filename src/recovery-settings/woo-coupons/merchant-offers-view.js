import { createElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

const CHOICES = ['NONE', 'FIXED', 'AI_BEST_APPLICABLE'];

function OfferChoices({ mode, disabled, onChange }) {
	const labels = {
		NONE: __('Do not offer a discount', 'moda-interact'),
		FIXED: __('Specific discount', 'moda-interact'),
		AI_BEST_APPLICABLE: __(
			'AI-selected applicable discount',
			'moda-interact'
		),
	};
	return createElement(
		'fieldset',
		{ className: 'moda-recovery-behaviour__offers' },
		createElement(
			'legend',
			{ className: 'screen-reader-text' },
			__('Recovery offer', 'moda-interact')
		),
		...CHOICES.map((value) =>
			createElement(
				'label',
				{
					key: value,
					className: `moda-recovery-behaviour__offer${mode === value ? ' is-active' : ''}`,
				},
				createElement('input', {
					type: 'radio',
					name: 'wooRecoveryOffer',
					value,
					checked: mode === value,
					disabled,
					onChange: () => onChange(value),
				}),
				createElement('strong', null, labels[value])
			)
		)
	);
}

function CouponCheckboxes({ items, selectedIds, disabled, onToggle }) {
	return createElement(
		'ul',
		{ className: 'moda-coupon-preview__results' },
		...items.map((item) =>
			createElement(
				'li',
				{ key: item.id },
				createElement(
					'label',
					{ className: 'moda-coupon-preview__item' },
					createElement('input', {
						type: 'checkbox',
						value: item.id,
						checked: selectedIds.includes(item.id),
						disabled,
						onChange: () => onToggle(item.id),
					}),
					createElement(
						'span',
						{ className: 'moda-coupon-preview__code', dir: 'auto' },
						item.code ?? item.title
					),
					createElement(
						'span',
						{ className: 'moda-coupon-preview__amount' },
						item.summary ?? item.providerType
					)
				)
			)
		)
	);
}

function CatalogueControls({ state, controller, term, onTermChange }) {
	const loading = state.catalogueStatus === 'LOADING';
	const page = state.page;
	if (loading) {
		return createElement(
			'p',
			{ role: 'status' },
			__('Loading…', 'moda-interact')
		);
	}
	if (state.catalogueStatus !== 'READY') {
		return createElement(
			'div',
			{ className: 'moda-coupon-preview__readiness' },
			createElement(
				'p',
				{
					role:
						state.catalogueStatus === 'ERROR' ? 'alert' : 'status',
				},
				state.catalogueStatus === 'NOT_READY'
					? __(
							'Coupon synchronisation is pending or unavailable.',
							'moda-interact'
						)
					: __('Coupons could not be loaded.', 'moda-interact')
			),
			createElement(
				'button',
				{
					type: 'button',
					className: 'button',
					onClick: () => void controller.retryCoupons(),
				},
				__('Retry coupons', 'moda-interact')
			)
		);
	}
	return createElement(
		'div',
		null,
		createElement(
			'form',
			{
				className: 'moda-coupon-preview__filters',
				onSubmit: (event) => {
					event.preventDefault();
					void controller.search(term);
				},
			},
			createElement(
				'label',
				null,
				__('Search coupons', 'moda-interact'),
				createElement('input', {
					type: 'search',
					maxLength: 80,
					value: term,
					onChange: (event) =>
						onTermChange(event.currentTarget.value),
				})
			),
			createElement(
				'button',
				{ className: 'button', type: 'submit' },
				__('Search', 'moda-interact')
			)
		),
		page?.items.length
			? createElement(CouponCheckboxes, {
					items: page.items,
					selectedIds: state.selectedIds,
					disabled: state.saving,
					onToggle: (id) => controller.toggle(id),
				})
			: createElement(
					'p',
					{ role: 'status' },
					__('No coupons found.', 'moda-interact')
				),
		page
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
							disabled: !state.history.length,
							onClick: () => void controller.previous(),
						},
						__('Previous', 'moda-interact')
					),
					createElement(
						'span',
						null,
						sprintf(
							/* translators: 1: current catalogue page; 2: last page is unknown until final page. */
							__('Page %1$s of %2$s', 'moda-interact'),
							String(state.history.length + 1),
							page.hasMore
								? '…'
								: String(state.history.length + 1)
						)
					),
					createElement(
						'button',
						{
							type: 'button',
							className: 'button',
							disabled: !page.hasMore,
							onClick: () => void controller.next(),
						},
						__('Next', 'moda-interact')
					)
				)
			: null,
		createElement(
			'p',
			{ role: 'status' },
			sprintf(
				/* translators: %s: total number of coupons selected, including across search pages. */
				__('%s selected', 'moda-interact'),
				String(state.selectedIds.length)
			)
		),
		state.selectedIds.length === 0
			? createElement(
					'p',
					{ role: 'alert' },
					__('Select at least one coupon.', 'moda-interact')
				)
			: null,
		createElement(
			'p',
			{ className: 'moda-recovery-behaviour__hint' },
			__(
				'WooCommerce determines whether a coupon can be redeemed.',
				'moda-interact'
			)
		)
	);
}

/**
 * Pure presentation for independent controller and rendering tests.
 * @param {Object}                 root0
 * @param {Object}                 root0.state
 * @param {Object}                 root0.controller
 * @param {string}                 root0.term
 * @param {(term: string) => void} root0.onTermChange
 */
export function MerchantOffersView({
	state,
	controller,
	term = '',
	onTermChange = () => {},
}) {
	const ready = state.status === 'READY';
	const dirty = controller.isDirty();
	const canSave =
		ready &&
		!state.saving &&
		dirty &&
		(state.mode !== 'FIXED' ||
			(state.catalogueStatus === 'READY' &&
				state.selectedIds.length > 0));
	let message = null;
	if (state.error === 'SAVED') {
		message = __('Recovery behaviour saved.', 'moda-interact');
	} else if (state.error) {
		message =
			state.error === 'INVALID_SELECTION' ||
			state.error === 'SELECTION_LIMIT_EXCEEDED'
				? __(
						'Review the recovery settings and try again.',
						'moda-interact'
					)
				: __(
						'Recovery behaviour could not be saved. Your edits are still visible.',
						'moda-interact'
					);
	}
	return createElement(
		'div',
		{
			className: 'moda-coupon-preview',
			'aria-busy': state.saving || state.status === 'LOADING',
		},
		state.status === 'LOADING'
			? createElement(
					'p',
					{ role: 'status' },
					__('Loading…', 'moda-interact')
				)
			: null,
		state.status === 'ERROR'
			? createElement(
					'div',
					null,
					createElement(
						'p',
						{ role: 'alert' },
						__(
							'Recovery settings could not be loaded. Refresh to retry.',
							'moda-interact'
						)
					),
					createElement(
						'button',
						{
							type: 'button',
							className: 'button',
							onClick: () => void controller.refresh(),
						},
						__('Retry', 'moda-interact')
					)
				)
			: null,
		ready
			? createElement(OfferChoices, {
					mode: state.mode,
					disabled: state.saving,
					onChange: (mode) => controller.setMode(mode),
				})
			: null,
		ready && state.offers?.overrideActive
			? createElement(
					'p',
					{ role: 'status' },
					__(
						'Effective settings include an administrator override',
						'moda-interact'
					)
				)
			: null,
		ready && state.mode === 'NONE'
			? createElement(
					'p',
					{ role: 'status' },
					__('No discount will be offered.', 'moda-interact')
				)
			: null,
		ready && state.mode === 'AI_BEST_APPLICABLE'
			? createElement(
					'p',
					{ role: 'status' },
					__(
						'This saves your preference; it does not send or redeem a coupon.',
						'moda-interact'
					)
				)
			: null,
		ready && state.mode === 'FIXED'
			? createElement(CatalogueControls, {
					state,
					controller,
					term,
					onTermChange,
				})
			: null,
		message
			? createElement(
					'p',
					{ role: state.error === 'SAVED' ? 'status' : 'alert' },
					message
				)
			: null,
		ready
			? createElement(
					'div',
					{ className: 'moda-recovery-behaviour__footer' },
					createElement(
						'button',
						{
							type: 'button',
							className: 'button',
							disabled: state.saving || !dirty,
							onClick: () => controller.cancel(),
						},
						__('Discard changes', 'moda-interact')
					),
					createElement(
						'button',
						{
							type: 'button',
							className: 'button button-primary',
							disabled: !canSave,
							onClick: () => void controller.save(),
						},
						state.saving
							? __('Saving…', 'moda-interact')
							: __('Save recovery behaviour', 'moda-interact')
					)
				)
			: null
	);
}
