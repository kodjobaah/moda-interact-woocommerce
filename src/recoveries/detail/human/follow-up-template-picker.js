import { createElement, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { humanActionAvailability } from './conversation-command-contract';

export function FollowUpTemplatePicker({ summary, human }) {
	const actions = humanActionAvailability(
		summary,
		Date.now(),
		human?.templates
	);
	const [selection, setSelection] = useState('');
	const templates = human?.templates ?? [];
	if (!actions.canOfferTemplatePicker) {
		return null;
	}

	const selected = templates.find(
		(template) => `${template.name}:${template.language}` === selection
	);
	const submit = async (event) => {
		event.preventDefault();
		if (
			!selected ||
			!actions.canTemplate ||
			human?.busy ||
			human?.command
		) {
			return;
		}
		await human.onSendTemplate({
			templateName: selected.name,
			templateLanguage: selected.language,
		});
	};

	return createElement(
		'form',
		{
			className:
				'moda-recovery-detail__composer moda-recovery-detail__template-picker',
			onSubmit: submit,
		},
		createElement(
			'h3',
			null,
			__('Approved follow-up template', 'moda-interact')
		),
		human?.templatesStatus === 'LOADING'
			? createElement(
					'p',
					{ role: 'status' },
					__('Loading approved templates…', 'moda-interact')
				)
			: null,
		human?.templatesStatus === 'ERROR'
			? createElement(
					'p',
					{ role: 'alert' },
					__(
						'Unable to load approved follow-up templates.',
						'moda-interact'
					)
				)
			: null,
		human?.templatesStatus === 'ERROR'
			? createElement(
					'button',
					{
						type: 'button',
						className: 'button',
						onClick: human.onRefreshTemplates,
					},
					__('Try again', 'moda-interact')
				)
			: null,
		human?.templatesStatus === 'READY' && templates.length === 0
			? createElement(
					'p',
					{ className: 'moda-recovery-detail__muted' },
					__(
						'No approved follow-up templates are available for this recovery.',
						'moda-interact'
					)
				)
			: null,
		templates.length > 0
			? createElement(
					'label',
					{ htmlFor: 'moda-recovery-follow-up-template' },
					__('Template and language', 'moda-interact'),
					createElement(
						'select',
						{
							id: 'moda-recovery-follow-up-template',
							value: selection,
							disabled:
								!actions.canTemplate ||
								human?.busy ||
								human?.command,
							onChange: (event) =>
								setSelection(event.target.value),
						},
						createElement(
							'option',
							{ value: '' },
							__('Select a template', 'moda-interact')
						),
						...templates.map((template) =>
							createElement(
								'option',
								{
									key: `${template.name}:${template.language}`,
									value: `${template.name}:${template.language}`,
								},
								`${template.name} — ${template.language}`
							)
						)
					)
				)
			: null,
		templates.length > 0
			? createElement(
					'button',
					{
						type: 'submit',
						className: 'button',
						disabled:
							!selected ||
							!actions.canTemplate ||
							human?.busy ||
							human?.command,
					},
					__('Queue follow-up', 'moda-interact')
				)
			: null
	);
}
