import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

export function handleCancelDialogKeyDown(event, setCancelDialogOpen) {
	if (event.key === 'Escape') {
		event.preventDefault();
		setCancelDialogOpen(false);
		return;
	}
	if (event.key !== 'Tab') {
		return;
	}
	const focusable = event.currentTarget.querySelectorAll(
		'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
	);
	if (!focusable.length) {
		return;
	}
	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	const activeElement = event.currentTarget.ownerDocument.activeElement;
	if (event.shiftKey && activeElement === first) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && activeElement === last) {
		event.preventDefault();
		first.focus();
	}
}

export function restoreCancelDialogFocus(cancelTriggerRef) {
	cancelTriggerRef.current?.focus();
}

export function CancelDialog({
	state,
	onCancel,
	setOpen,
	keepPlanRef,
	dialogCancelRef,
}) {
	return createElement(
		'div',
		{
			className: 'moda-interact-cancel-dialog',
			role: 'alertdialog',
			'aria-modal': 'true',
			'aria-labelledby': 'moda-interact-cancel-title',
			'aria-describedby': 'moda-interact-cancel-description',
			onKeyDown: (event) => handleCancelDialogKeyDown(event, setOpen),
		},
		createElement(
			'h3',
			{ id: 'moda-interact-cancel-title' },
			__('Cancel recurring plan?', 'moda-interact')
		),
		createElement(
			'p',
			{ id: 'moda-interact-cancel-description' },
			__(
				'Paid access remains available until cancellation is verified and the prepaid term ends. This request does not immediately change your current plan.',
				'moda-interact'
			)
		),
		createElement(
			'div',
			{ className: 'moda-interact-cancel-dialog__actions' },
			createElement(
				'button',
				{
					type: 'button',
					className: 'button',
					ref: keepPlanRef,
					onClick: () => setOpen(false),
				},
				__('Keep current plan', 'moda-interact')
			),
			createElement(
				'button',
				{
					type: 'button',
					className: 'button button-primary',
					ref: dialogCancelRef,
					disabled: state.command !== null,
					'aria-busy': state.command === 'SUBMITTING',
					onClick: () => {
						setOpen(false);
						onCancel();
					},
				},
				state.command === 'SUBMITTING'
					? __('Submitting…', 'moda-interact')
					: __('Confirm cancellation', 'moda-interact')
			)
		)
	);
}
