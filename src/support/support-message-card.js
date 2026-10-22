import { createElement, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

const systemActions = Object.freeze({
	BILLING_FREE_ALLOWANCE_WARNING: 'moda-interact-billing',
	BILLING_SUBSCRIPTION_ENDED: 'moda-interact-billing',
	BILLING_PLAN_UPGRADED: 'moda-interact-billing',
	BILLING_PLAN_DOWNGRADE_SCHEDULED: 'moda-interact-billing',
	BILLING_SAFETY_LIMIT_REACHED: 'moda-interact-billing',
});

/**
 * Fixed first-party targets only; never render a provider-supplied href.
 * @param {Object} message Support message data.
 */
export function supportSystemHref(message) {
	const page =
		message.kind === 'SYSTEM' ? systemActions[message.systemCode] : null;
	return page ? `admin.php?page=${page}` : null;
}

export function SupportMessageCard({ message }) {
	const [original, setOriginal] = useState(false);
	let sender = __('Moda Support', 'moda-interact');
	if (message.kind === 'MERCHANT') {
		sender = __('You', 'moda-interact');
	} else if (message.kind === 'SYSTEM') {
		sender = __('System', 'moda-interact');
	}
	const translated =
		message.isTranslated === true &&
		typeof message.originalBody === 'string' &&
		typeof message.displayBody === 'string';
	const notReady =
		message.kind !== 'MERCHANT' &&
		(message.displayBody === null || message.displayBody === undefined);
	const href = supportSystemHref(message);
	let body;
	if (notReady) {
		body =
			message.state === 'FAILED'
				? __('Translation unavailable', 'moda-interact')
				: __('Translation pending', 'moda-interact');
	} else if (original) {
		body = message.originalBody;
	} else {
		body = message.displayBody ?? message.originalBody;
	}
	return createElement(
		'li',
		{
			className: `moda-support__message moda-support__message--${
				['MERCHANT', 'SYSTEM', 'ADMINISTRATIVE'].includes(message.kind)
					? message.kind.toLowerCase()
					: 'unknown'
			}`,
		},
		createElement(
			'div',
			{ className: 'moda-support__message-head' },
			createElement('strong', null, sender),
			createElement(
				'time',
				{ dateTime: message.createdAt },
				new Date(message.createdAt).toLocaleString(undefined, {
					month: 'short',
					day: 'numeric',
					hour: 'numeric',
					minute: '2-digit',
				})
			),
			!message.readAt &&
				message.kind !== 'MERCHANT' &&
				message.state === 'AVAILABLE'
				? createElement(
						'span',
						{ className: 'moda-support__unread' },
						__('Unread', 'moda-interact')
					)
				: null
		),
		createElement('p', { dir: 'auto' }, body),
		translated
			? createElement(
					'button',
					{
						type: 'button',
						className: 'button-link',
						onClick: () => setOriginal((value) => !value),
					},
					original
						? __('View translation', 'moda-interact')
						: __('View original', 'moda-interact')
				)
			: null,
		href
			? createElement('a', { href }, __('View billing', 'moda-interact'))
			: null
	);
}
