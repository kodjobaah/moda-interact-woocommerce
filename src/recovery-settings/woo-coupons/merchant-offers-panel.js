import { createElement, useEffect, useRef, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { MerchantOffersController } from './offer-controller';

const CHOICES = [
	['NONE', 'Do not offer a discount'],
	['FIXED', 'Specific discount'],
	['AI_BEST_APPLICABLE', 'AI-selected applicable discount'],
];

function OfferChoices({ mode, disabled, onChange }) {
	const labels = {
		NONE: __('Do not offer a discount', 'moda-interact'),
		FIXED: __('Specific discount', 'moda-interact'),
		AI_BEST_APPLICABLE: __('AI-selected applicable discount', 'moda-interact'),
	};
	return createElement('fieldset', { className: 'moda-recovery-behaviour__offers' },
		createElement('legend', { className: 'screen-reader-text' }, __('Recovery offer', 'moda-interact')),
		...CHOICES.map(([value]) => createElement('label', {
			key: value, className: `moda-recovery-behaviour__offer${mode === value ? ' is-active' : ''}`,
		}, createElement('input', { type: 'radio', name: 'wooRecoveryOffer', value,
			checked: mode === value, disabled, onChange: () => onChange(value) }),
		createElement('strong', null, labels[value]))));
}

function CouponCheckboxes({ items, selectedIds, disabled, onToggle }) {
	return createElement('ul', { className: 'moda-coupon-preview__results' },
		...items.map((item) => createElement('li', { key: item.id },
			createElement('label', { className: 'moda-coupon-preview__item' },
				createElement('input', { type: 'checkbox', value: item.id,
					checked: selectedIds.includes(item.id), disabled,
					onChange: () => onToggle(item.id) }),
				createElement('span', { className: 'moda-coupon-preview__code', dir: 'auto' }, item.code ?? item.title),
				createElement('span', { className: 'moda-coupon-preview__amount' }, item.summary ?? item.providerType)))));
}

/** WordPress-hosted, explicitly saved merchant configuration; not offer execution. */
export function MerchantOffersPanel({ controller: injected }) {
	const holder = useRef(null);
	if (!holder.current) holder.current = injected ?? new MerchantOffersController();
	const controller = holder.current;
	const [state, setState] = useState(controller.state);
	const [term, setTerm] = useState('');
	useEffect(() => {
		const stop = controller.subscribe(setState);
		void controller.refresh();
		return () => { stop(); if (!injected) controller.dispose(); };
	}, [controller, injected]);
	const working = state.saving || state.status === 'PAGING' || state.status === 'LOADING';
	const ready = state.status === 'READY';
	const dirty = controller.isDirty();
	const page = state.page;
	// Only diagnose missing selections when the unfiltered catalogue fits one page.
	// On multi-page results an absent ID may simply be on another page.
	const unavailableCount = page && !page.hasMore && !state.history.length && !state.search
		? state.selectedIds.filter((id) => !page.items.some((item) => item.id === id)).length : 0;
	let notice = null;
	if (state.status === 'NOT_READY') notice = __('WooCommerce coupon selection is not yet available.', 'moda-interact');
	else if (['ERROR', 'LOADING'].includes(state.status)) notice = state.status === 'LOADING'
		? __('Loading…', 'moda-interact') : __('Coupons could not be loaded.', 'moda-interact');
	else if (state.error === 'SAVED') notice = __('Recovery behaviour saved.', 'moda-interact');
	else if (state.error === 'INVALID_SELECTION') notice = __('Review the recovery settings and try again.', 'moda-interact');
	else if (state.error) notice = __('Recovery behaviour could not be saved. Your edits are still visible.', 'moda-interact');
	return createElement('div', { className: 'moda-coupon-preview', 'aria-busy': working },
		createElement(OfferChoices, { mode: state.mode, disabled: !ready || working,
			onChange: (mode) => controller.setMode(mode) }),
		state.offers?.overrideActive ? createElement('p', { role: 'status' },
			__('Effective settings include an administrator override', 'moda-interact')) : null,
		state.mode === 'FIXED' && ready ? createElement('div', null,
			createElement('form', { className: 'moda-coupon-preview__filters', onSubmit: (event) => {
				event.preventDefault(); void controller.search(term);
			} },
			createElement('label', null, __('Search coupons', 'moda-interact'),
				createElement('input', { type: 'search', maxLength: 80, value: term,
					onChange: (event) => setTerm(event.currentTarget.value) })),
			createElement('button', { className: 'button', type: 'submit', disabled: working },
				__('Search', 'moda-interact'))),
			page?.items.length ? createElement(CouponCheckboxes, { items: page.items,
				selectedIds: state.selectedIds, disabled: working,
				onToggle: (id) => controller.toggle(id) }) : createElement('p', { role: 'status' },
				__('No coupons found.', 'moda-interact')),
			page ? createElement('nav', { className: 'moda-coupon-preview__pagination',
				'aria-label': __('Browse coupons', 'moda-interact') },
				createElement('button', { type: 'button', className: 'button', disabled: working || !state.history.length,
					onClick: () => void controller.previous() }, __('Previous', 'moda-interact')),
				createElement('span', null, sprintf(
					/* translators: 1: current catalogue page, 2: total pages not known until last page. */
					__('Page %1$s of %2$s', 'moda-interact'), String(state.history.length + 1),
					page.hasMore ? '…' : String(state.history.length + 1))),
				createElement('button', { type: 'button', className: 'button', disabled: working || !page.hasMore,
					onClick: () => void controller.next() }, __('Next', 'moda-interact'))) : null,
			state.selectedIds.length ? createElement('p', { role: 'status' },
				sprintf(
					/* translators: %s: number of coupons the merchant selected. */
					__('%s selected', 'moda-interact'), String(state.selectedIds.length))) : null,
			state.selectedIds.length === 0 ? createElement('p', { role: 'alert' },
				__('Select at least one coupon.', 'moda-interact')) : null,
			unavailableCount ? createElement('p', { role: 'note' },
				sprintf(
					/* translators: %s: number of saved coupons not in the current catalogue. */
					__('%s selected', 'moda-interact'), String(unavailableCount)), ' — ',
				__('Not available', 'moda-interact')) : null
		) : null,
		notice ? createElement('p', { role: state.error && state.error !== 'SAVED' ? 'alert' : 'status' }, notice) : null,
		['NOT_READY', 'ERROR'].includes(state.status) ? createElement('button', { type: 'button', className: 'button',
			onClick: () => void controller.refresh() }, __('Refresh', 'moda-interact')) : null,
		createElement('div', { className: 'moda-recovery-behaviour__footer' },
			createElement('button', { type: 'button', className: 'button', disabled: !ready || working || !dirty,
				onClick: () => controller.cancel() }, __('Discard changes', 'moda-interact')),
			createElement('button', { type: 'button', className: 'button button-primary',
				disabled: !ready || working || !dirty || state.mode === 'FIXED' && !state.selectedIds.length,
				onClick: () => void controller.save() }, working && state.saving ? __('Saving…', 'moda-interact') :
				__('Save recovery behaviour', 'moda-interact'))));
}
