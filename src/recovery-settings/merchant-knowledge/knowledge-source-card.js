import { createElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { validKnowledgeUrl } from './knowledge-client';
import { formatLabel, purposeLabel, sourceStatus } from './knowledge-display';
import { field, languageSelect } from './knowledge-form-fields';
import { KnowledgeUploadForm } from './knowledge-upload-form';

function editForm(source, data, disabled, onAction) {
	return createElement(
		'form',
		{
			className: 'moda-knowledge__edit-form',
			onSubmit: (event) => {
				event.preventDefault();
				if (disabled) {
					return;
				}
				const elements = event.currentTarget.elements;
				const name = elements.namedItem('name')?.value?.trim() ?? '';
				const languageTag =
					elements.namedItem('languageTag')?.value ?? '';
				const url = elements.namedItem('url')?.value ?? '';
				if (
					!name ||
					!languageTag ||
					(source.dataFormatKey === 'WEB_PAGE' &&
						!validKnowledgeUrl(url))
				) {
					return;
				}
				onAction('editSource', {
					id: source.id,
					name,
					languageTag,
					...(source.dataFormatKey === 'WEB_PAGE' ? { url } : {}),
				});
			},
		},
		field(
			__('Source name', 'moda-interact'),
			createElement('input', {
				name: 'name',
				defaultValue: source.name,
				maxLength: 160,
				required: true,
				disabled,
			})
		),
		source.dataFormatKey === 'WEB_PAGE'
			? field(
					__('URL', 'moda-interact'),
					createElement('input', {
						name: 'url',
						type: 'url',
						defaultValue: source.revision?.requestedUrl ?? '',
						maxLength: 2048,
						required: true,
						disabled,
					})
				)
			: null,
		field(
			__('Language', 'moda-interact'),
			languageSelect(data, disabled, source.languageTag)
		),
		createElement(
			'button',
			{ type: 'submit', className: 'button button-primary', disabled },
			__('Save', 'moda-interact')
		)
	);
}

function sourceDetails(source) {
	const units =
		source.revision?.activeContentUnits ??
		source.activeRevision?.contentUnits;
	const truncated =
		source.revision?.activeTruncated ?? source.activeRevision?.truncated;
	const fetchedAt =
		source.revision?.activeFetchedAt ?? source.activeRevision?.fetchedAt;
	const date =
		fetchedAt && !Number.isNaN(Date.parse(fetchedAt))
			? new Date(fetchedAt).toLocaleString()
			: null;
	return createElement(
		'div',
		{ className: 'moda-knowledge__source-details' },
		createElement(
			'p',
			null,
			purposeLabel(source.purposeKey, source.purposeDisplayName),
			' · ',
			formatLabel(source.dataFormatKey, source.dataFormatDisplayName),
			' · ',
			source.languageTag
		),
		createElement(
			'p',
			null,
			source.uploadedFileName ??
				source.revision?.requestedUrl ??
				(source.dataFormatKey === 'WEB_PAGE'
					? __('No URL recorded', 'moda-interact')
					: '—')
		),
		Number.isSafeInteger(units)
			? createElement(
					'p',
					null,
					sprintf(
						/* translators: %s: number of active content units. */
						__('%s active content units', 'moda-interact'),
						String(units)
					),
					truncated ? ` · ${__('truncated', 'moda-interact')}` : ''
				)
			: null,
		date
			? createElement(
					'p',
					null,
					sprintf(
						/* translators: %s: last processing date. */
						__('Last processed %s', 'moda-interact'),
						date
					)
				)
			: null
	);
}

export function KnowledgeSourceCard({
	source,
	index,
	sources,
	data,
	permissions,
	busy,
	onAction,
}) {
	const status = sourceStatus(source);
	const editable = !busy && source.currentlyPlanEntitled !== false;
	const processing = ['PENDING', 'PROCESSING'].includes(
		source.revision?.status
	);
	const file = ['CSV', 'XLSX'].includes(source.dataFormatKey);
	const buttons = [
		['UP', __('Move source up', 'moda-interact'), index !== 0],
		[
			'DOWN',
			__('Move source down', 'moda-interact'),
			index !== sources.length - 1,
		],
	];
	return createElement(
		'li',
		{ className: 'moda-knowledge__source', key: source.id },
		createElement(
			'div',
			{ className: 'moda-knowledge__source-header' },
			createElement('strong', null, source.name),
			createElement(
				'span',
				{ className: `moda-knowledge__badge is-${status.tone}` },
				status.label
			)
		),
		sourceDetails(source),
		status.tone === 'processing'
			? createElement(
					'p',
					{
						className: 'moda-knowledge__processing-note',
						role: 'status',
					},
					__(
						'This page updates automatically while the source is processing.',
						'moda-interact'
					)
				)
			: null,
		source.revision?.status === 'FAILED'
			? createElement(
					'p',
					{ role: 'status' },
					__('Processing failed', 'moda-interact')
				)
			: null,
		createElement(
			'div',
			{ className: 'moda-knowledge__actions' },
			...buttons.map(([direction, label, inRange]) =>
				createElement(
					'button',
					{
						key: direction,
						type: 'button',
						className: 'button',
						disabled: busy || !permissions.moveSource || !inRange,
						'aria-label': label,
						title: label,
						onClick: () => {
							const ids = sources.map((entry) => entry.id);
							const other = index + (direction === 'UP' ? -1 : 1);
							[ids[index], ids[other]] = [ids[other], ids[index]];
							onAction('moveSource', {
								id: source.id,
								direction,
								sourceIds: ids,
							});
						},
					},
					label
				)
			),
			source.dataFormatKey === 'WEB_PAGE'
				? createElement(
						'button',
						{
							type: 'button',
							className: 'button',
							disabled:
								!editable ||
								!permissions.refreshSource ||
								!source.processingEligible,
							onClick: () =>
								onAction('refreshSource', { id: source.id }),
						},
						__('Refresh', 'moda-interact')
					)
				: createElement(
						'button',
						{
							type: 'button',
							className: 'button',
							disabled:
								!editable ||
								processing ||
								!permissions.reprocessSource ||
								!source.processingEligible,
							onClick: () =>
								onAction('reprocessSource', { id: source.id }),
						},
						__('Reprocess', 'moda-interact')
					),
			file
				? createElement(
						'details',
						{ className: 'moda-knowledge__action-disclosure' },
						createElement(
							'summary',
							null,
							__('Replace file', 'moda-interact')
						),
						createElement(KnowledgeUploadForm, {
							data,
							busy,
							source,
							enabled: editable && !!permissions.replaceSource,
							onAction,
						})
					)
				: null,
			createElement(
				'details',
				{ className: 'moda-knowledge__action-disclosure' },
				createElement('summary', null, __('Edit', 'moda-interact')),
				editForm(
					source,
					data,
					!editable || !permissions.editSource,
					onAction
				)
			),
			createElement(
				'button',
				{
					type: 'button',
					className: 'button',
					disabled:
						busy ||
						!permissions.deleteSource ||
						source.dataFormatKey !== 'WEB_PAGE' ||
						source.currentlyPlanEntitled === false,
					onClick: () => {
						const confirm =
							typeof window !== 'undefined' &&
							typeof window.confirm === 'function' &&
							window.confirm(
								`${__('Delete', 'moda-interact')} — ${source.name}?`
							);
						if (confirm) {
							onAction('deleteSource', { id: source.id });
						}
					},
				},
				__('Delete', 'moda-interact')
			)
		)
	);
}
