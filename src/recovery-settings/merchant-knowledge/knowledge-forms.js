import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import {
	catalogueFor,
	formatLabel,
	sourceCapacityAvailable,
} from './knowledge-display';
import { unavailableReason } from './knowledge-form-fields';
import { KnowledgeUploadForm } from './knowledge-upload-form';
import { KnowledgeWebForm } from './knowledge-web-form';

// Native details/summary implements keyboard interaction without a custom toggle.
export function KnowledgeAddForms({
	data,
	busy = false,
	preserveUnavailable = false,
	onAction = () => {},
}) {
	const web = catalogueFor(data, 'REMOTE_URL').filter(
		(item) => item.dataFormat.key === 'WEB_PAGE'
	);
	const uploads = catalogueFor(data, 'UPLOAD').filter((item) =>
		['CSV', 'XLSX'].includes(item.dataFormat.key)
	);
	const capacity = sourceCapacityAvailable(data);
	const ready = !!data?.planEntitled;
	const enabledWeb = ready && capacity && !!data.permissions?.addUrl && !busy;
	const enabledUpload =
		ready && capacity && !!data.permissions?.upload && !busy;

	return createElement(
		'div',
		{ className: 'moda-knowledge__add-grid' },
		web.length || preserveUnavailable
			? createElement(
					'details',
					{ className: 'moda-knowledge__disclosure', open: true },
					createElement(
						'summary',
						null,
						createElement(
							'strong',
							null,
							__('Add web page', 'moda-interact')
						),
						createElement('small', null, formatLabel('WEB_PAGE'))
					),
					createElement(KnowledgeWebForm, {
						data,
						catalogue: web,
						disabled: !enabledWeb,
						onAction,
					}),
					!enabledWeb && !busy
						? createElement(
								'p',
								{
									className: 'moda-knowledge__hint',
									role: 'status',
								},
								unavailableReason('addUrl')
							)
						: null
				)
			: createElement(
					'p',
					{ role: 'status' },
					__(
						'No web page source types are available for this plan.',
						'moda-interact'
					)
				),
		uploads.length || preserveUnavailable || ready
			? createElement(
					'details',
					{ className: 'moda-knowledge__disclosure', open: true },
					createElement(
						'summary',
						null,
						createElement(
							'strong',
							null,
							__('Upload file', 'moda-interact')
						),
						createElement(
							'small',
							null,
							[
								...new Set(
									uploads.map((item) => item.dataFormat.key)
								),
							]
								.map((key) => formatLabel(key))
								.join(' / ')
						)
					),
					createElement(KnowledgeUploadForm, {
						data,
						busy,
						enabled: enabledUpload,
						onAction,
					}),
					!enabledUpload && !busy
						? createElement(
								'p',
								{
									className: 'moda-knowledge__hint',
									role: 'status',
								},
								ready && !uploads.length
									? `${__('Upload file', 'moda-interact')} — ${__('Not included in your plan', 'moda-interact')}`
									: ready && !capacity
										? __(
											"Your plan's shared knowledge-source limit has been reached.",
											'moda-interact'
										)
										: unavailableReason('upload')
							)
						: null
				)
			: null
	);
}
