import { createElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { KnowledgeSourceList } from './knowledge-source-list';
import { KnowledgeAddForms } from './knowledge-forms';
import { sourceCapacity } from './knowledge-display';

function knowledgeErrorMessage(status) {
	switch (status) {
		case 'UNAVAILABLE':
			return __(
				'This section is not yet available for WooCommerce.',
				'moda-interact'
			);
		case 'DENIED':
			return __(
				'You do not have permission to manage knowledge sources.',
				'moda-interact'
			);
		case 'CONFLICT':
			return __(
				'Knowledge sources changed elsewhere. Refresh to review them.',
				'moda-interact'
			);
		default:
			return __(
				'Knowledge sources could not be loaded. Try again later.',
				'moda-interact'
			);
	}
}

// The panel is embedded inside Recovery Settings > Store & assistant context.
export function MerchantKnowledgePanel({
	state = { status: 'IDLE', data: null },
	onRefresh = () => {},
	onAction = () => {},
}) {
	const { status, data } = state;
	const busy = status === 'LOADING' || status === 'SAVING';
	const ready = !!data && ['READY', 'LOADING', 'SAVING'].includes(status);
	const entitled = ready && data.planEntitled === true;
	const { configured, limit } = sourceCapacity(data);
	const count =
		Number.isSafeInteger(configured) && Number.isSafeInteger(limit)
			? sprintf(
					/* translators: 1: configured sources; 2: permitted sources. */
					__('%1$s of %2$s sources configured', 'moda-interact'),
					String(configured),
					String(limit)
				)
			: null;
	const permissions = !busy && ready ? (data?.permissions ?? {}) : {};
	return createElement(
		'details',
		{
			id: 'merchant-knowledge',
			className: 'moda-knowledge',
			open: true,
			'aria-labelledby': 'merchant-knowledge-title',
			'aria-busy': busy,
		},
		createElement(
			'summary',
			{ className: 'moda-knowledge__heading' },
			createElement(
				'strong',
				{ id: 'merchant-knowledge-title' },
				__('Merchant Knowledge', 'moda-interact')
			),
			entitled && count ? createElement('small', null, count) : null
		),
		createElement(
			'div',
			{ className: 'moda-knowledge__body' },
			entitled && data.merchantEnabled === false
				? createElement(
						'p',
						{ className: 'moda-knowledge__notice', role: 'status' },
						__(
							'Ingestion and retrieval are disabled until Merchant Knowledge is enabled in Conversation Features. Configured sources are retained.',
							'moda-interact'
						)
					)
				: null,
			entitled && count
				? createElement(
						'p',
						{
							className: 'moda-knowledge__capacity',
							role: 'status',
						},
						count
					)
				: null,
			ready && !entitled
				? createElement(
						'p',
						{ role: 'status' },
						__(
							'Merchant Knowledge configuration is unavailable on the current plan.',
							'moda-interact'
						)
					)
				: null,
			busy
				? createElement(
						'p',
						{ role: 'status' },
						status === 'LOADING'
							? __('Loading…', 'moda-interact')
							: __('Saving…', 'moda-interact')
					)
				: null,
			!ready && !busy
				? createElement(
						'p',
						{
							role: ['UNAVAILABLE', 'IDLE'].includes(status)
								? 'status'
								: 'alert',
						},
						status === 'IDLE'
							? __('Loading…', 'moda-interact')
							: knowledgeErrorMessage(status)
					)
				: null,
			entitled
				? createElement(KnowledgeAddForms, {
						data: { ...data, permissions },
						busy,
						onAction,
					})
				: null,
			entitled
				? createElement(KnowledgeSourceList, {
						data,
						sources: data.sources ?? [],
						permissions,
						busy,
						onAction,
					})
				: null,
			['ERROR', 'CONFLICT', 'DENIED', 'UNAVAILABLE'].includes(status)
				? createElement(
						'button',
						{
							type: 'button',
							className: 'button',
							onClick: onRefresh,
						},
						__('Retry', 'moda-interact')
					)
				: null
		)
	);
}
