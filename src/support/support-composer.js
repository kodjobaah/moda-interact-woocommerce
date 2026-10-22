import { createElement, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { countSupportGraphemes, validSupportBody } from './support-validation';

export function SupportComposer({ sendStatus, canSend, readStatus, onSend }) {
	const [body, setBody] = useState('');
	const [invalid, setInvalid] = useState(false);
	const count = countSupportGraphemes(body);
	const busy = sendStatus === 'SENDING';
	async function submit(event) {
		event.preventDefault();
		if (!canSend || busy) {
			return;
		}
		if (!validSupportBody(body)) {
			setInvalid(true);
			return;
		}
		setInvalid(false);
		const sent = await onSend(body);
		if (sent) {
			setBody('');
		}
	}
	return createElement(
		'section',
		{
			className: 'moda-support__panel',
			'aria-labelledby': 'moda-support-contact',
		},
		createElement(
			'h2',
			{ id: 'moda-support-contact' },
			__('Contact support', 'moda-interact')
		),
		createElement(
			'form',
			{ noValidate: true, onSubmit: submit },
			createElement(
				'label',
				{ htmlFor: 'moda-support-body' },
				__('Message', 'moda-interact')
			),
			createElement('textarea', {
				id: 'moda-support-body',
				value: body,
				rows: 5,
				disabled: !canSend || busy,
				'aria-describedby': 'moda-support-count moda-support-error',
				'aria-invalid': invalid || count > 500,
				onChange: (event) => {
					setBody(event.target.value);
					setInvalid(false);
				},
			}),
			createElement(
				'div',
				{ className: 'moda-support__compose-footer' },
				createElement(
					'span',
					{ id: 'moda-support-count', 'aria-live': 'polite' },
					`${count}/500`
				),
				createElement(
					'button',
					{
						type: 'submit',
						className: 'button button-primary',
						disabled:
							!canSend || busy || count > 500 || count === 0,
					},
					busy
						? __('Sending…', 'moda-interact')
						: __('Send', 'moda-interact')
				)
			)
		),
		!canSend && readStatus === 'UNAVAILABLE'
			? createElement(
					'p',
					{ id: 'moda-support-error', role: 'status' },
					__(
						'Sending support messages is not yet available for WooCommerce.',
						'moda-interact'
					)
				)
			: null,
		invalid || sendStatus === 'INVALID'
			? createElement(
					'p',
					{ id: 'moda-support-error', role: 'alert' },
					__('Enter 1 to 500 characters.', 'moda-interact')
				)
			: null,
		sendStatus === 'ERROR'
			? createElement(
					'p',
					{ id: 'moda-support-error', role: 'alert' },
					__('The message could not be sent.', 'moda-interact')
				)
			: null,
		sendStatus === 'SENT'
			? createElement(
					'p',
					{
						id: 'moda-support-error',
						className: 'moda-support__sr-only',
						role: 'status',
					},
					__('Message sent', 'moda-interact')
				)
			: null
	);
}
