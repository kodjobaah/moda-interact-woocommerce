import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { KnowledgeSourceCard } from './knowledge-source-card';

export function KnowledgeSourceList({
	sources = [], data = {}, permissions = {}, busy = false, onAction = () => {},
}) {
	if (!sources.length) {
		return createElement('p', { role: 'status' },
			__('No knowledge sources configured.', 'moda-interact'));
	}
	return createElement('ol', { className: 'moda-knowledge__sources' },
		...sources.map((source, index) => createElement(KnowledgeSourceCard, {
			key: source.id, source, index, sources, data, permissions, busy, onAction,
		}))
	);
}
