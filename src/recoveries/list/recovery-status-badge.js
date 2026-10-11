import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

const labels = {
	DETECTED: () => __('Detected', 'moda-interact'),
	MESSAGE_SENT: () => __('Message sent', 'moda-interact'),
	ENGAGED: () => __('Engaged', 'moda-interact'),
	COMPLETED: () => __('Completed', 'moda-interact'),
	EXPIRED: () => __('Expired', 'moda-interact'),
	CANCELLED: () => __('Cancelled', 'moda-interact'),
};

export function RecoveryStatusBadge({ status }) {
	if (!Object.hasOwn(labels, status)) {
		return createElement('span', null, __('Unavailable', 'moda-interact'));
	}
	return createElement(
		'span',
		{
			className: `moda-recoveries__badge moda-recoveries__badge--${status}`,
		},
		labels[status]()
	);
}
