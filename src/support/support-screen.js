import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { useSupport } from './use-support';
import { SupportThread } from './support-thread';
import { SupportComposer } from './support-composer';

/** Connected merchant Support, using the privileged WordPress REST facade. */
export function SupportScreen() {
	const support = useSupport();
	return createElement(
		'div',
		{
			className: 'moda-support',
			'aria-labelledby': 'moda-support-heading',
		},
		createElement(
			'header',
			{ className: 'moda-support__header' },
			createElement(
				'h1',
				{ id: 'moda-support-heading' },
				__('Support', 'moda-interact')
			),
			createElement(
				'p',
				null,
				__(
					'Contact Moda support and review your messages.',
					'moda-interact'
				)
			)
		),
		createElement(SupportThread, {
			state: support.state,
			canRead: support.capabilities.read,
			onRefresh: support.refresh,
			onPage: support.page,
		}),
		createElement(SupportComposer, {
			sendStatus: support.state.sendStatus,
			canSend:
				support.capabilities.send &&
				!support.state.sendBlocked &&
				support.state.status === 'READY',
			readStatus: support.state.status,
			onSend: support.send,
		})
	);
}
