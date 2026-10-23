import { createElement, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { useSelection } from './use-selection';
import { isCanonicalPhone, isTicketReference } from './selection-contract';
import { selectionErrorMessage } from './selection-messages';

/** Existing Woo merchant Recoveries surface; all writes go via privileged WP REST. */
export function CustomerRecoverySelectionPanel() {
	const { state, lookup, command } = useSelection();
	const [phone, setPhone] = useState('');
	const [reference, setReference] = useState('');
	const [confirmed, setConfirmed] = useState(false);
	const busy = ['LOADING', 'SAVING'].includes(state.phase);
	const current =
		state.phase === 'READY' && state.phone === phone && state.record;
	const record = current ? state.record : null;
	const onLookup = (event) => {
		event.preventDefault();
		if (!busy) {
			lookup(phone);
		}
	};
	const onAction = (action) => {
		if (busy || !record) {
			return;
		}
		command(action, action === 'RECORD_CUSTOMER_STOP' ? reference : null);
		if (action === 'RECORD_CUSTOMER_STOP') {
			setReference('');
			setConfirmed(false);
		}
	};
	let status;
	if (record?.suppressionReason === 'CUSTOMER_STOP') {
		status = __(
			'Customer STOP blocks all WhatsApp contact.',
			'moda-interact'
		);
	} else if (record?.suppressionReason === 'MERCHANT_OPT_OUT') {
		status = __(
			'Merchant recovery suppression is active.',
			'moda-interact'
		);
	} else if (record?.phoneEligibleForRecovery) {
		status = __(
			'Customer phone is eligible for recovery selection.',
			'moda-interact'
		);
	} else {
		status = __(
			'Customer phone is not eligible for recovery.',
			'moda-interact'
		);
	}
	return createElement(
		'section',
		{
			className: 'moda-recovery-selection',
			'aria-labelledby': 'moda-recovery-selection-heading',
			'aria-busy': busy,
		},
		createElement(
			'h2',
			{ id: 'moda-recovery-selection-heading' },
			__('Customer recovery selection', 'moda-interact')
		),
		createElement(
			'p',
			null,
			__(
				'Select an existing customer phone by international digits without +. Merchant selection never grants WhatsApp consent.',
				'moda-interact'
			)
		),
		createElement(
			'form',
			{ onSubmit: onLookup },
			createElement(
				'label',
				{ htmlFor: 'moda-recovery-phone' },
				__('Customer phone', 'moda-interact')
			),
			createElement(
				'div',
				{ className: 'moda-recovery-selection__row' },
				createElement('input', {
					id: 'moda-recovery-phone',
					type: 'tel',
					inputMode: 'numeric',
					autoComplete: 'off',
					maxLength: 15,
					value: phone,
					disabled: busy,
					onChange: (event) => {
						setPhone(event.target.value);
						setConfirmed(false);
					},
				}),
				createElement(
					'button',
					{
						type: 'submit',
						className: 'button',
						disabled: busy || !isCanonicalPhone(phone),
					},
					__('Look up phone', 'moda-interact')
				)
			)
		),
		state.phase === 'ERROR'
			? createElement(
					'p',
					{ role: 'alert' },
					selectionErrorMessage(state.error)
				)
			: null,
		record
			? createElement(
					'div',
					{ className: 'moda-recovery-selection__result' },
					createElement(
						'p',
						{ role: 'status' },
						record.consentDecision === 'GRANTED'
							? __('WhatsApp consent: granted', 'moda-interact')
							: __(
									'WhatsApp consent: not granted',
									'moda-interact'
								)
					),
					createElement('p', { role: 'status' }, status),
					state.outcome
						? createElement(
								'p',
								{ role: 'status' },
								state.outcome === 'duplicate'
									? __(
											'Selection was already recorded.',
											'moda-interact'
										)
									: __(
											'Customer recovery selection updated.',
											'moda-interact'
										)
							)
						: null,
					createElement(
						'div',
						{ className: 'moda-recovery-selection__row' },
						createElement(
							'button',
							{
								type: 'button',
								className: 'button',
								disabled: busy || record.suppressed,
								onClick: () => onAction('SUPPRESS'),
							},
							__('Suppress recovery', 'moda-interact')
						),
						createElement(
							'button',
							{
								type: 'button',
								className: 'button',
								disabled: busy || !record.canReenable,
								onClick: () => onAction('REENABLE'),
							},
							__('Re-enable recovery', 'moda-interact')
						)
					),
					createElement(
						'label',
						{ htmlFor: 'moda-recovery-evidence' },
						__('External support ticket reference', 'moda-interact')
					),
					createElement(
						'p',
						null,
						__(
							'Keep the ticket in your own records; Moda does not store this reference.',
							'moda-interact'
						)
					),
					createElement('input', {
						id: 'moda-recovery-evidence',
						type: 'text',
						autoComplete: 'off',
						maxLength: 128,
						value: reference,
						disabled:
							busy ||
							record.suppressionReason === 'CUSTOMER_STOP',
						onChange: (event) => {
							setReference(event.target.value);
							setConfirmed(false);
						},
					}),
					createElement(
						'label',
						{ className: 'moda-recovery-selection__confirm' },
						createElement('input', {
							type: 'checkbox',
							checked: confirmed,
							disabled:
								busy ||
								record.suppressionReason === 'CUSTOMER_STOP',
							onChange: (event) =>
								setConfirmed(event.target.checked),
						}),
						__(
							'I confirm the customer requested STOP outside WhatsApp.',
							'moda-interact'
						)
					),
					createElement(
						'button',
						{
							type: 'button',
							className: 'button',
							disabled:
								busy ||
								record.suppressionReason === 'CUSTOMER_STOP' ||
								!confirmed ||
								!isTicketReference(reference),
							onClick: () => onAction('RECORD_CUSTOMER_STOP'),
						},
						__('Record customer STOP', 'moda-interact')
					)
				)
			: null
	);
}
