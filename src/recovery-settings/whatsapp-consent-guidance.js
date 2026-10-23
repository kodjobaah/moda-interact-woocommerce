import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

/** Informational only. This panel does not confer or change customer consent. */
export function WhatsAppConsentGuidance() {
	return createElement(
		'section',
		{
			className: 'moda-interact-recovery__panel',
			'aria-labelledby': 'moda-interact-woo-whatsapp-consent-title',
		},
		createElement(
			'h2',
			{ id: 'moda-interact-woo-whatsapp-consent-title' },
			__('WhatsApp checkout-recovery permission', 'moda-interact')
		),
		createElement(
			'p',
			null,
			__(
				'Moda shows an unchecked WhatsApp marketing checkbox on eligible checkouts. It covers reminders from this store about unfinished checkouts, not order updates. Showing a checkbox or collecting a phone number is not consent; an explicit choice must be verified by Moda.',
				'moda-interact'
			)
		),
		createElement(
			'p',
			null,
			__(
				"Without verified permission, checkout recovery cannot start. Customers may contact the store to withdraw consent. An unchecked box on a later visit does not revoke an earlier grant; the customer's current preference must be checked before recovery.",
				'moda-interact'
			)
		)
	);
}
