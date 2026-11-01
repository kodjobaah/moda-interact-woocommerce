import { createElement, useEffect, useRef, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

/**
 * @param {Object}   props          Current canonical value and input callbacks.
 * @param {string}   props.value    Draft minute value.
 * @param {boolean}  props.disabled Whether the input is read-only.
 * @param {Function} props.onChange Receives the edited string value.
 */
export function AiResponseDelayFields({ value, disabled, onChange }) {
	const invalid =
		!disabled && (!/^(?:0|[1-9]\d*)$/.test(value) || Number(value) > 30);
	return createElement(
		'div',
		{ className: 'moda-ai-response-delay__fields' },
		createElement(
			'div',
			{ className: 'moda-ai-response-delay__field' },
			createElement(
				'label',
				{ htmlFor: 'woo-ai-response-delay-minutes' },
				__('AI response delay (minutes)', 'moda-interact')
			),
			createElement('input', {
				id: 'woo-ai-response-delay-minutes',
				name: 'aiResponseDelayMinutes',
				type: 'number',
				min: 0,
				max: 30,
				step: 1,
				value,
				disabled,
				'aria-invalid': invalid || undefined,
				'aria-describedby': invalid
					? 'woo-ai-response-delay-error'
					: undefined,
				onChange: (event) => onChange(event.currentTarget.value),
			}),
			invalid
				? createElement(
						'p',
						{ id: 'woo-ai-response-delay-error', role: 'alert' },
						__(
							'Enter a whole number from 0 to 30.',
							'moda-interact'
						)
					)
				: null
		),
		createElement(
			'p',
			{ className: 'moda-ai-response-delay__human-guidance' },
			__('Human replies are immediate.', 'moda-interact')
		)
	);
}

function DelayNotice({ status }) {
	const messages = {
		SAVED: __('Recovery behaviour saved.', 'moda-interact'),
		SAVING: __('Saving…', 'moda-interact'),
		CONFLICT: __(
			'Recovery settings changed elsewhere. Refresh to review the latest policy before saving again. Your edits are still visible.',
			'moda-interact'
		),
		SAVE_FAILED: __(
			'Recovery behaviour could not be saved. Your edits are still visible.',
			'moda-interact'
		),
		ERROR: __(
			'Recovery settings could not be loaded. Refresh to retry.',
			'moda-interact'
		),
		RECONNECT_REQUIRED: __(
			'Recovery settings could not be loaded. Refresh to retry.',
			'moda-interact'
		),
		INVALID_REQUEST: __(
			'Review the recovery settings and try again.',
			'moda-interact'
		),
	};
	const message = messages[status];
	if (!message) {
		return null;
	}
	return createElement(
		'p',
		{
			className: 'moda-ai-response-delay__notice',
			role: [
				'CONFLICT',
				'SAVE_FAILED',
				'ERROR',
				'RECONNECT_REQUIRED',
				'INVALID_REQUEST',
			].includes(status)
				? 'alert'
				: 'status',
		},
		message
	);
}

/** A distinct setting and save action, separate from initial recovery timing. */
export function AiResponseDelayPanel({ state, onRefresh, onSave }) {
	const status = state?.status ?? 'IDLE';
	const data = state?.data ?? null;
	const [draft, setDraft] = useState('');
	const appliedData = useRef(null);

	useEffect(() => {
		if (
			data &&
			['READY', 'SAVED'].includes(status) &&
			appliedData.current !== data
		) {
			appliedData.current = data;
			setDraft(String(data.aiResponseDelayMinutes));
		}
	}, [data, status]);

	const ready =
		Boolean(data) && ['READY', 'SAVED', 'SAVE_FAILED'].includes(status);
	const saving = status === 'SAVING';
	const valid = /^(?:0|[1-9]\d*)$/.test(draft) && Number(draft) <= 30;
	const dirty =
		Boolean(data) && draft !== String(data.aiResponseDelayMinutes);
	const canRefresh = [
		'ERROR',
		'CONFLICT',
		'SAVE_FAILED',
		'RECONNECT_REQUIRED',
	].includes(status);
	return createElement(
		'section',
		{
			className: 'moda-interact-recovery__panel moda-ai-response-delay',
			'aria-labelledby': 'woo-ai-response-delay-title',
			'aria-busy': ['LOADING', 'SAVING'].includes(status),
		},
		createElement(
			'div',
			{ className: 'moda-interact-recovery__body' },
			createElement(
				'h2',
				{ id: 'woo-ai-response-delay-title' },
				__('Recovery Settings', 'moda-interact')
			),
			createElement(DelayNotice, { status }),
			createElement(AiResponseDelayFields, {
				value: draft,
				disabled: !ready || saving,
				onChange: setDraft,
			}),
			createElement(
				'div',
				{ className: 'moda-interact-recovery__actions' },
				canRefresh
					? createElement(
							'button',
							{
								type: 'button',
								className: 'button',
								onClick: onRefresh,
							},
							__('Refresh', 'moda-interact')
						)
					: null,
				createElement(
					'button',
					{
						type: 'button',
						className: 'button button-primary',
						disabled: !ready || !dirty || !valid || saving,
						onClick: () =>
							onSave({ aiResponseDelayMinutes: draft }),
					},
					saving
						? __('Saving…', 'moda-interact')
						: __('Save AI response delay', 'moda-interact')
				)
			)
		)
	);
}
