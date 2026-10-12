import { createElement, useEffect, useRef, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { RecoveryBehaviourFields } from './recovery-behaviour-fields';
import { CouponCataloguePreview } from './woo-coupons/coupon-preview';
import {
	recoveryBehaviourPreview,
	recoveryBehaviourChanged,
	validateRecoveryBehaviourPreview,
} from './recovery-behaviour-validation';

function PolicyNotice({ status, dirty, overrideActive }) {
	let content = null;
	if (status === 'SAVED' && !dirty) {
		content = __('Recovery behaviour saved.', 'moda-interact');
	} else if (status === 'SAVING') {
		content = __('Saving…', 'moda-interact');
	} else if (status === 'CONFLICT') {
		content = __(
			'Recovery settings changed elsewhere. Refresh to review the latest policy before saving again. Your edits are still visible.',
			'moda-interact'
		);
	} else if (status === 'SAVE_FAILED') {
		content = __(
			'Recovery behaviour could not be saved. Your edits are still visible.',
			'moda-interact'
		);
	} else if (status === 'ERROR' || status === 'RECONNECT_REQUIRED') {
		content = __(
			'Recovery settings could not be loaded. Refresh to retry.',
			'moda-interact'
		);
	} else if (status === 'OFFER_UNSUPPORTED') {
		content = __(
			'WooCommerce coupon selection is not yet available.',
			'moda-interact'
		);
	} else if (status === 'INVALID_REQUEST') {
		content = __(
			'Review the recovery settings and try again.',
			'moda-interact'
		);
	} else if (overrideActive) {
		content = __(
			'Effective settings include an administrator override',
			'moda-interact'
		);
	}
	if (!content) {
		return null;
	}
	const alert = [
		'CONFLICT',
		'SAVE_FAILED',
		'ERROR',
		'RECONNECT_REQUIRED',
		'OFFER_UNSUPPORTED',
		'INVALID_REQUEST',
	].includes(status);
	return createElement(
		'p',
		{
			className: 'moda-recovery-behaviour__notice',
			role: alert ? 'alert' : 'status',
		},
		content
	);
}

/**
 * The form is initialised from merchant preferences; admin overrides are display-only.
 * No save occurs until the merchant clicks Save recovery behaviour.
 *
 * @param {Object}                             root0
 * @param {Object}                             root0.policyState
 * @param {() => Promise<Object>}              root0.onRefreshPolicy
 * @param {(draft: Object) => Promise<Object>} root0.onSavePolicy
 */
export function RecoveryBehaviourPanel({
	policyState,
	onRefreshPolicy,
	onSavePolicy,
}) {
	const policy = policyState?.data ?? null;
	const status = policyState?.status ?? 'IDLE';
	const [draft, setDraft] = useState(() => recoveryBehaviourPreview(null));
	const appliedPolicy = useRef(null);

	useEffect(() => {
		if (
			policy &&
			['READY', 'SAVED'].includes(status) &&
			appliedPolicy.current !== policy
		) {
			appliedPolicy.current = policy;
			setDraft(recoveryBehaviourPreview(policy.merchant));
		}
	}, [policy, status]);

	const ready =
		Boolean(policy) && ['READY', 'SAVED', 'SAVE_FAILED'].includes(status);
	const saving = status === 'SAVING';
	const errors = ready
		? validateRecoveryBehaviourPreview(draft)
		: { start: false, followUp: false };
	const dirty =
		Boolean(policy) && recoveryBehaviourChanged(policy.merchant, draft);
	const canSave =
		ready &&
		dirty &&
		!errors.start &&
		!errors.followUp &&
		policy.merchant.recoveryOfferMode === 'NONE';
	const canRefresh = [
		'ERROR',
		'CONFLICT',
		'OFFER_UNSUPPORTED',
		'RECONNECT_REQUIRED',
	].includes(status);
	return createElement(
		'section',
		{
			className: 'moda-recovery-behaviour moda-interact-recovery__panel',
			'aria-label': __('Recovery Settings', 'moda-interact'),
			'aria-busy': ['LOADING', 'SAVING'].includes(status),
		},
		createElement(PolicyNotice, {
			status,
			dirty,
			overrideActive: policy?.overrideActive === true,
		}),
		createElement(RecoveryBehaviourFields, {
			couponPreview: createElement(CouponCataloguePreview),
			effective: policy?.effective ?? null,
			draft,
			errors,
			ready: ready && !saving,
			onChange: (name, value) =>
				setDraft((current) => ({ ...current, [name]: value })),
		}),
		createElement(
			'div',
			{ className: 'moda-recovery-behaviour__footer' },
			canRefresh
				? createElement(
						'p',
						{ className: 'moda-recovery-behaviour__refresh' },
						__(
							'Refreshing will replace unsaved recovery changes.',
							'moda-interact'
						)
					)
				: null,
			canRefresh
				? createElement(
						'button',
						{
							type: 'button',
							className: 'button',
							onClick: onRefreshPolicy,
						},
						__('Refresh', 'moda-interact')
					)
				: null,
			createElement(
				'button',
				{
					type: 'button',
					className: 'button button-primary',
					disabled: !canSave,
					onClick: () => onSavePolicy(draft),
				},
				saving
					? __('Saving…', 'moda-interact')
					: __('Save recovery behaviour', 'moda-interact')
			)
		)
	);
}
