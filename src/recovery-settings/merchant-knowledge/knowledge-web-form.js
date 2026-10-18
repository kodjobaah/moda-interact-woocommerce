import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { validKnowledgeUrl } from './knowledge-client';
import { field, languageSelect, purposeOptions } from './knowledge-form-fields';
import { formatLabel } from './knowledge-display';

export function KnowledgeWebForm({ data, catalogue, disabled, onAction }) {
	return createElement(
		'form',
		{
			className: 'moda-knowledge__form moda-knowledge__form--web',
			onSubmit: (event) => {
				event.preventDefault();
				if (disabled) {
					return;
				}
				const elements = event.currentTarget.elements;
				const name = elements.namedItem('name')?.value?.trim() ?? '';
				const purpose = elements.namedItem('purpose')?.value ?? '';
				const languageTag =
					elements.namedItem('languageTag')?.value ?? '';
				const url = elements.namedItem('url')?.value ?? '';
				if (name && purpose && languageTag && validKnowledgeUrl(url)) {
					onAction('addUrl', { name, purpose, languageTag, url });
				}
			},
		},
		field(
			__('Source name', 'moda-interact'),
			createElement('input', {
				name: 'name',
				type: 'text',
				maxLength: 160,
				required: true,
				disabled,
			})
		),
		field(
			__('Purpose', 'moda-interact'),
			createElement(
				'select',
				{ name: 'purpose', required: true, disabled },
				...purposeOptions(catalogue)
			)
		),
		field(
			__('Data format', 'moda-interact'),
			createElement('input', {
				className: 'moda-knowledge__readonly',
				type: 'text',
				value: formatLabel('WEB_PAGE'),
				readOnly: true,
				tabIndex: -1,
			})
		),
		field(
			__('URL', 'moda-interact'),
			createElement('input', {
				name: 'url',
				type: 'url',
				maxLength: 2048,
				placeholder: 'https://',
				required: true,
				disabled,
			})
		),
		field(__('Language', 'moda-interact'), languageSelect(data, disabled)),
		createElement(
			'button',
			{
				type: 'submit',
				className: 'button button-primary moda-knowledge__submit',
				disabled,
			},
			__('Add web page', 'moda-interact')
		)
	);
}
