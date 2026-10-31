import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

/**
 * Explain automatic checkout-field registration without claiming that the
 * current storefront has been checked. Only show a feature status when it came
 * from a confirmed merchant feature-preferences response.
 */
export function WhatsAppConsentGuidance({ featurePreferencesState } = {}) {
	const confirmed = ['READY', 'SAVED'].includes(
		featurePreferencesState?.status
	);
	const checkoutRecovery = confirmed
		? featurePreferencesState?.data?.features?.find(
				(feature) => feature.key === 'checkout_recovery'
			)
		: null;

	return createElement(
		'section',
		{
			className:
				'moda-interact-recovery__panel moda-interact-woo-consent',
			'aria-labelledby': 'moda-interact-woo-whatsapp-consent-title',
		},
		createElement(
			'div',
			{ className: 'moda-interact-recovery__body' },
			createElement(
				'h2',
				{ id: 'moda-interact-woo-whatsapp-consent-title' },
				__('WhatsApp checkout-recovery permission', 'moda-interact')
			),
			createElement(
				'p',
				{ className: 'moda-interact-woo-consent__intro' },
				__(
					'Moda automatically adds an optional, unchecked WhatsApp marketing checkbox for unfinished-checkout reminders when Checkout Recovery is eligible. No manual installation is needed. Classic: after billing phone. Blocks: under Order Information.',
					'moda-interact'
				)
			),
			checkoutRecovery
				? createElement(
						'div',
						{ className: 'moda-interact-woo-consent__feature' },
						createElement('strong', null, checkoutRecovery.name),
						createElement(
							'span',
							null,
							checkoutRecovery.effective
								? __('Currently enabled', 'moda-interact')
								: __('Currently disabled', 'moda-interact')
						)
					)
				: null,
			createElement(
				'p',
				{ className: 'moda-interact-woo-consent__note' },
				__(
					'Checkout Recovery requires a verified customer choice, not just a phone number. Leaving the checkbox unchecked later does not withdraw an earlier grant; customers can contact the store to withdraw.',
					'moda-interact'
				)
			)
		)
	);
}
