import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { formatLabel, purposeLabel } from './knowledge-display';

export function field(label, child, className = '') {
	return createElement(
		'label',
		{ className: `moda-knowledge__field ${className}`.trim() },
		createElement('span', null, label),
		child
	);
}

export function languageSelect(data, disabled, initial) {
	const tags = data?.supportedLanguageTags ?? [];
	const preferred = initial ?? data?.defaultLanguageTag;
	return createElement(
		'select',
		{
			name: 'languageTag',
			defaultValue: tags.includes(preferred)
				? preferred
				: (tags[0] ?? ''),
			disabled,
			required: true,
		},
		...tags.map((tag) =>
			createElement('option', { key: tag, value: tag }, tag)
		)
	);
}

export function purposeOptions(catalogue) {
	return [
		...new Map(
			catalogue.map((item) => [item.purpose.key, item.purpose])
		).values(),
	].map((item) =>
		createElement(
			'option',
			{ key: item.key, value: item.key },
			purposeLabel(item.key, item.displayName)
		)
	);
}

export function formatOptions(catalogue) {
	return [
		...new Map(
			catalogue.map((item) => [item.dataFormat.key, item.dataFormat])
		).values(),
	].map((item) =>
		createElement(
			'option',
			{ key: item.key, value: item.key },
			formatLabel(item.key, item.displayName)
		)
	);
}

export function unavailableReason(kind) {
	const label =
		kind === 'addUrl'
			? __('Add web page', 'moda-interact')
			: __('Upload file', 'moda-interact');
	return `${label} — ${__('Unavailable', 'moda-interact')}`;
}
