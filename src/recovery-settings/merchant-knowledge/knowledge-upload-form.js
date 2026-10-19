import { createElement, useRef, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { validKnowledgeFile } from './knowledge-client';
import { catalogueFor } from './knowledge-display';
import {
	field,
	formatOptions,
	languageSelect,
	purposeOptions,
} from './knowledge-form-fields';

function sourceNameFromFile(fileName) {
	return fileName
		.replace(/\.[^.]+$/, '')
		.replace(/[_-]+/g, ' ')
		.trim()
		.slice(0, 160);
}

// Hook-owning wrapper; field rendering and validation stay independently testable.
export function KnowledgeUploadForm({
	data,
	busy = false,
	enabled = false,
	source = null,
	onAction = () => {},
}) {
	const all = catalogueFor(data, 'UPLOAD').filter(
		(item) =>
			!source ||
			(item.purpose.key === source.purposeKey &&
				item.dataFormat.key === source.dataFormatKey)
	);
	const [purpose, setPurpose] = useState(
		source?.purposeKey ?? all[0]?.purpose.key ?? ''
	);
	const [format, setFormat] = useState(
		source?.dataFormatKey ?? all[0]?.dataFormat.key ?? ''
	);
	const [name, setName] = useState(source?.name ?? '');
	const [file, setFile] = useState(null);
	const nameEdited = useRef(Boolean(source?.name));
	const forPurpose = all.filter((entry) => entry.purpose.key === purpose);
	const pair =
		forPurpose.find((entry) => entry.dataFormat.key === format) ??
		forPurpose[0];
	const selectedFormat = pair?.dataFormat.key ?? '';
	const validFile = validKnowledgeFile(
		file,
		data?.maxUploadBytes,
		selectedFormat
	);
	const disabled =
		!enabled || busy || !pair || !data?.supportedLanguageTags?.length;
	const canSubmit = !disabled && validFile && !!name.trim();

	return createElement(KnowledgeUploadFields, {
		data,
		all,
		forPurpose,
		purpose,
		selectedFormat,
		name,
		disabled,
		canSubmit,
		source,
		onPurposeChange: (next) => {
			setPurpose(next);
			setFormat(
				all.find((entry) => entry.purpose.key === next)?.dataFormat
					.key ?? ''
			);
			setFile(null);
		},
		onFormatChange: (next) => {
			setFormat(next);
			setFile(null);
		},
		onNameChange: (next) => {
			nameEdited.current = true;
			setName(next);
		},
		onFileChange: (next) => {
			setFile(next);
			if (next && !nameEdited.current) {
				setName(sourceNameFromFile(next.name));
			}
		},
		onSubmit: (languageTag) => {
			if (!canSubmit || !languageTag) {
				return;
			}
			onAction(source ? 'replaceSource' : 'upload', {
				...(source ? { id: source.id } : {}),
				name: name.trim(),
				purpose,
				dataFormatKey: selectedFormat,
				languageTag,
				file,
			});
		},
	});
}

export function KnowledgeUploadFields({
	data,
	all,
	forPurpose,
	purpose,
	selectedFormat,
	name,
	disabled,
	canSubmit,
	source,
	onPurposeChange,
	onFormatChange,
	onNameChange,
	onFileChange,
	onSubmit,
}) {
	const item = forPurpose.find(
		(entry) => entry.dataFormat.key === selectedFormat
	);
	const accept = item?.dataFormat.canonicalExtension ?? '';
	const maxId = `moda-knowledge-max-upload-${source?.id ?? 'new'}`;
	return createElement(
		'form',
		{
			className: 'moda-knowledge__form moda-knowledge__form--upload',
			onSubmit: (event) => {
				event.preventDefault();
				if (canSubmit) {
					onSubmit(
						event.currentTarget.elements.namedItem('languageTag')
							?.value
					);
				}
			},
		},
		field(
			__('Purpose', 'moda-interact'),
			createElement(
				'select',
				{
					name: 'purpose',
					value: purpose,
					disabled: disabled || !!source,
					required: true,
					onChange: (event) =>
						onPurposeChange(event.currentTarget.value),
				},
				...purposeOptions(all)
			)
		),
		field(
			__('Data format', 'moda-interact'),
			createElement(
				'select',
				{
					name: 'dataFormatKey',
					value: selectedFormat,
					disabled: disabled || !!source,
					required: true,
					onChange: (event) =>
						onFormatChange(event.currentTarget.value),
				},
				...formatOptions(forPurpose)
			)
		),
		field(
			__('Source name', 'moda-interact'),
			createElement('input', {
				name: 'name',
				type: 'text',
				value: name,
				maxLength: 160,
				required: true,
				disabled,
				onChange: (event) => onNameChange(event.currentTarget.value),
			})
		),
		field(
			__('File', 'moda-interact'),
			createElement('input', {
				key: `${purpose}:${selectedFormat}`,
				name: 'file',
				type: 'file',
				accept,
				required: true,
				disabled,
				'aria-describedby': maxId,
				onChange: (event) =>
					onFileChange(event.currentTarget.files?.[0] ?? null),
			}),
			'moda-knowledge__file'
		),
		createElement(
			'p',
			{ className: 'moda-knowledge__max-upload', id: maxId },
			Number.isSafeInteger(data?.maxUploadBytes) &&
				data.maxUploadBytes > 0
				? sprintf(
						/* translators: %s: maximum file size, in bytes. */
						__('Maximum upload size: %s bytes', 'moda-interact'),
						String(data.maxUploadBytes)
					)
				: __('Unavailable', 'moda-interact')
		),
		field(
			__('Language', 'moda-interact'),
			languageSelect(data, disabled, source?.languageTag)
		),
		createElement(
			'button',
			{
				type: 'submit',
				className: 'button button-primary moda-knowledge__submit',
				disabled: !canSubmit,
			},
			source
				? __('Replace file', 'moda-interact')
				: __('Upload file', 'moda-interact')
		)
	);
}
