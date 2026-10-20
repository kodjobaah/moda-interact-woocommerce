import { createElement, useRef, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { validKnowledgeFile } from './knowledge-client';
import { catalogueFor } from './knowledge-display';
import {
	field,
	formatOptions,
	languageSelect,
	planUploadFormatOptions,
	purposeOptions,
} from './knowledge-form-fields';

function sourceNameFromFile(fileName) {
	return fileName
		.replace(/\.[^.]+$/, '')
		.replace(/[_-]+/g, ' ')
		.trim()
		.slice(0, 160);
}

// Match only upload formats permitted for the selected purpose. The filename is
// a UI hint, never a substitute for hosted validation of content and size.
export function matchingUploadFormat(file, catalogue) {
	if (typeof file?.name !== 'string') {
		return null;
	}
	const filename = file.name.trim().toLowerCase();
	return (
		catalogue.find((entry) => {
			const { key, canonicalExtension } = entry.dataFormat;
			return (
				['CSV', 'XLSX'].includes(key) &&
				typeof canonicalExtension === 'string' &&
				filename.endsWith(canonicalExtension.toLowerCase())
			);
		})?.dataFormat.key ?? null
	);
}

// A known file format absent from the authorised catalogue cannot be uploaded.
// Unknown extensions remain rejected by validKnowledgeFile rather than being
// misleadingly described as a plan restriction.
export function fileFormatDisallowedByPlan(file, catalogue) {
	const extension = /\.(csv|xlsx)$/i.exec(file?.name ?? '')?.[1];
	return (
		!!extension &&
		!catalogue.some(
			(entry) => entry.dataFormat.key === extension.toUpperCase()
		)
	);
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
	const fileInputRef = useRef(null);
	const formRef = useRef(null);
	const forPurpose = all.filter((entry) => entry.purpose.key === purpose);
	const pair =
		forPurpose.find((entry) => entry.dataFormat.key === format) ??
		forPurpose[0];
	const selectedFormat =
		(!source && matchingUploadFormat(file, forPurpose)) ||
		pair?.dataFormat.key ||
		'';
	const validFile = validKnowledgeFile(
		file,
		data?.maxUploadBytes,
		selectedFormat
	);
	const disabled =
		!enabled || busy || !pair || !data?.supportedLanguageTags?.length;
	const canSubmit = !disabled && validFile && !!name.trim();
	const clearSelectedFile = () => {
		if (fileInputRef.current) {
			fileInputRef.current.value = '';
		}
		setFile(null);
	};

	return createElement(KnowledgeUploadFields, {
		data,
		all,
		forPurpose,
		purpose,
		selectedFormat,
		name,
		file,
		disabled,
		canSubmit,
		fileInputRef,
		formRef,
		source,
		onPurposeChange: (next) => {
			setPurpose(next);
			setFormat(
				all.find((entry) => entry.purpose.key === next)?.dataFormat
					.key ?? ''
			);
			clearSelectedFile();
		},
		onFormatChange: (next) => {
			setFormat(next);
			clearSelectedFile();
		},
		onNameChange: (next) => {
			nameEdited.current = true;
			setName(next);
		},
		onFileChange: (next) => {
			if (next && !source) {
				const detected = matchingUploadFormat(next, forPurpose);
				if (detected) {
					setFormat(detected);
				}
			}
			setFile(next);
			if (next && !nameEdited.current) {
				setName(sourceNameFromFile(next.name));
			}
		},
		onSubmit: (languageTag) => {
			if (!canSubmit || !languageTag) {
				return;
			}
			const action = source ? 'replaceSource' : 'upload';
			Promise.resolve(
				onAction(action, {
					...(source ? { id: source.id } : {}),
					name: name.trim(),
					purpose,
					dataFormatKey: selectedFormat,
					languageTag,
					file,
				})
			)
				.then((result) => {
					if (result?.confirmedAction !== action) return;
					formRef.current?.reset();
					clearSelectedFile();
					if (!source) {
						setName('');
						setPurpose(all[0]?.purpose.key ?? '');
						setFormat(all[0]?.dataFormat.key ?? '');
						nameEdited.current = false;
					}
				})
				.catch(() => {
					// The controller displays failures; retain the merchant's draft.
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
	file = null,
	disabled,
	canSubmit,
	fileInputRef,
	formRef,
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
	const accept = source
		? (item?.dataFormat.canonicalExtension ?? '')
		: [
				...new Set(
					forPurpose
						.map((entry) => entry.dataFormat.canonicalExtension)
						.filter(Boolean)
				),
			].join(',');
	const maxId = `moda-knowledge-max-upload-${source?.id ?? 'new'}`;
	const disallowedFile =
		!source && fileFormatDisallowedByPlan(file, forPurpose);
	const slotsAvailable =
		!source &&
		data?.planEntitled === true &&
		all.length > 0 &&
		Number.isSafeInteger(data?.configuredCount) &&
		Number.isSafeInteger(data?.maxKnowledgeSources) &&
		data.maxKnowledgeSources > 0;
	const remainingSlots = slotsAvailable
		? Math.max(0, data.maxKnowledgeSources - data.configuredCount)
		: null;
	return createElement(
		'form',
		{
			ref: formRef,
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
				...(source
					? formatOptions(forPurpose)
					: planUploadFormatOptions(forPurpose))
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
				ref: fileInputRef,
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
		disallowedFile
			? createElement(
					'p',
					{ className: 'moda-knowledge__plan-warning', role: 'alert' },
					__(
						'The selected file format is not included in your plan for this purpose.',
						'moda-interact'
					)
				)
			: null,
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
		),
		remainingSlots !== null
			? createElement(
					'p',
					{ className: 'moda-knowledge__quota', role: 'status' },
					sprintf(
						/* translators: 1: remaining source slots; 2: plan source limit. */
						__(
							'Remaining slots for file uploads: %1$s (shared with web pages; %2$s sources total).',
							'moda-interact'
						),
						String(remainingSlots),
						String(data.maxKnowledgeSources)
					)
				)
			: null
	);
}
