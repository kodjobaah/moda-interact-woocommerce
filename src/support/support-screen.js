import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { useSupport } from './use-support';
import { SupportThread } from './support-thread';
import { SupportComposer } from './support-composer';

/** Connected merchant support page; unsupported backend operations remain disabled. */
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
			canSend: support.capabilities.send,
			onSend: support.send,
		})
	);
}
