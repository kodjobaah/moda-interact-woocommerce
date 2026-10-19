import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { KnowledgeSourceCard } from './knowledge-source-card';

export function KnowledgeSourceList({
	sources = [],
	data = {},
	permissions = {},
	busy = false,
	unavailable = false,
	onAction = () => {},
}) {
	if (unavailable) {
		return createElement(
			'section',
			{
				className: 'moda-knowledge__sources-placeholder',
				'aria-labelledby': 'merchant-knowledge-sources-unavailable',
			},
			createElement(
				'h3',
				{ id: 'merchant-knowledge-sources-unavailable' },
				__(
					'Knowledge sources could not be loaded. Try again later.',
					'moda-interact'
				)
			),
			createElement('div', {
				className: 'moda-knowledge__sources-empty-shape',
				'aria-hidden': true,
			})
		);
	}
	if (!sources.length) {
		return createElement(
			'p',
			{ role: 'status' },
			__('No knowledge sources configured.', 'moda-interact')
		);
	}
	return createElement(
		'ol',
		{ className: 'moda-knowledge__sources' },
		...sources.map((source, index) =>
			createElement(KnowledgeSourceCard, {
				key: source.id,
				source,
				index,
				sources,
				data,
				permissions,
				busy,
				onAction,
			})
		)
	);
}
