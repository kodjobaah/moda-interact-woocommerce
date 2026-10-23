import { __ } from '@wordpress/i18n';

export function selectionErrorMessage(code) {
	switch (code) {
		case 'INVALID_REQUEST':
			return __(
				'Check the phone format or ticket reference.',
				'moda-interact'
			);
		case 'CUSTOMER_PHONE_NOT_FOUND':
			return __(
				'No matching customer phone in this store.',
				'moda-interact'
			);
		case 'AMBIGUOUS_CUSTOMER_PHONE':
			return __(
				'Multiple phone records match. Contact support.',
				'moda-interact'
			);
		case 'CUSTOMER_CONSENT_REQUIRED':
			return __(
				'Re-enabling requires the customer to have opted in.',
				'moda-interact'
			);
		case 'CUSTOMER_STOP_AUTHORITATIVE':
			return __(
				'Customer STOP cannot be cleared by the merchant.',
				'moda-interact'
			);
		case 'FORBIDDEN':
			return __(
				'Only store administrators can manage this selection.',
				'moda-interact'
			);
		case 'RECONNECT_REQUIRED':
		case 'LOCAL_STATE_INVALID':
		case 'SITE_URL_CHANGED':
			return __(
				'Reconnect the store before changing recovery selection.',
				'moda-interact'
			);
		default:
			return __(
				'Unable to verify the result. Look up the phone again.',
				'moda-interact'
			);
	}
}
