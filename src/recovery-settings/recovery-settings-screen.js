import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { CategoryProfileSummary } from './category-profile-summary';
import { CategorySelector } from './category-selector';
import { RecoverySettingsHeader } from './recovery-settings-header';

function Feedback({ status }) {
	const messages = {
		CONFLICT: __(
			'Another administrator changed the store category. Refresh the categories, review the latest selection, then save again.',
			'moda-interact'
		),
		CATEGORY_UNAVAILABLE: __(
			'The selected category or prompt is no longer available. Refresh the catalogue and choose an available category.',
			'moda-interact'
		),
		RECONNECT_REQUIRED: __(
			'The Moda Interact connection needs attention before categories can be updated.',
			'moda-interact'
		),
		ERROR: __(
			'Category settings could not be loaded or saved. Your existing category is unchanged; please retry.',
			'moda-interact'
		),
		SAVED: __(
			'Store category and assistant prompt activated.',
			'moda-interact'
		),
		SAVED_NEEDS_REFRESH: __(
			'Store category saved, but the updated settings could not be loaded. Refresh to confirm the active category.',
			'moda-interact'
		),
	};
	if (!messages[status]) {
		return null;
	}
	return createElement(
		'p',
		{
			role: ['SAVED', 'SAVED_NEEDS_REFRESH'].includes(status)
				? 'status'
				: 'alert',
			className: 'moda-interact-message',
		},
		messages[status]
	);
}

export function RecoverySettingsScreen({
	state,
	onRefresh,
	onChoose,
	onToggleMapping,
	onSave,
}) {
	const loading = state.status === 'LOADING';
	const saving = state.status === 'SAVING';
	const hasData = state.data !== null && state.data !== undefined;
	const editable = ['READY', 'SAVED', 'CATEGORY_UNAVAILABLE'].includes(
		state.status
	);
	const categories = state.data?.categories ?? [];
	return createElement(
		'section',
		{
			className: 'moda-interact-recovery',
			'aria-labelledby': 'moda-interact-recovery-heading',
			'aria-busy': loading || saving,
		},
		createElement(RecoverySettingsHeader),
		createElement(
			'details',
			{ open: true, className: 'moda-interact-recovery__panel' },
			createElement(
				'summary',
				null,
				__('Store & assistant context', 'moda-interact')
			),
			createElement(
				'div',
				{ className: 'moda-interact-recovery__body' },
				createElement(
					'h3',
					null,
					__('Store category', 'moda-interact')
				),
				loading
					? createElement(
							'p',
							{ role: 'status' },
							__('Loading store categories…', 'moda-interact')
						)
					: null,
				createElement(Feedback, { status: state.status }),
				hasData
					? createElement(CategoryProfileSummary, {
							profile: state.data.storeProfile,
						})
					: null,
				hasData && categories.length === 0
					? createElement(
							'p',
							{ role: 'status' },
							__(
								'There are currently no selectable store categories.',
								'moda-interact'
							)
						)
					: null,
				hasData && categories.length > 0
					? createElement(CategorySelector, {
							categories,
							categoryId: state.categoryId,
							mappingIds: state.mappingIds,
							disabled: !editable,
							onChoose,
							onToggle: onToggleMapping,
						})
					: null,
				createElement(
					'div',
					{ className: 'moda-interact-recovery__actions' },
					createElement(
						'button',
						{
							type: 'button',
							className: 'button',
							disabled: loading || saving,
							onClick: onRefresh,
						},
						__('Refresh categories', 'moda-interact')
					),
					createElement(
						'button',
						{
							type: 'button',
							className: 'button button-primary',
							disabled: !editable || !state.categoryId,
							onClick: onSave,
						},
						saving
							? __('Saving…', 'moda-interact')
							: __('Save category', 'moda-interact')
					)
				)
			)
		)
	);
}
