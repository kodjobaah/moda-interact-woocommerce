import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { RecoveryDatePresets } from './recovery-date-presets';
import { RecoveryFilterForm } from './recovery-filter-form';

export function RecoveryFilterPanel({
	filters,
	today,
	error,
	busy = false,
	timeZone,
	onChange,
	onPreset,
	onClear,
	onSubmit,
}) {
	return createElement(
		'section',
		{
			className: 'moda-recoveries__panel moda-recoveries__filters',
			'aria-label': __('Recoveries', 'moda-interact'),
		},
		createElement(RecoveryDatePresets, {
			selected: filters.preset,
			onSelect: onPreset,
		}),
		createElement(RecoveryFilterForm, {
			filters,
			today,
			error,
			busy,
			onChange,
			onSubmit,
		}),
		createElement(
			'div',
			{ className: 'moda-recoveries__filter-footer' },
			createElement(
				'p',
				null,
				__('Time zone', 'moda-interact'),
				': ',
				timeZone || __('Not available', 'moda-interact')
			),
			createElement(
				'button',
				{ type: 'button', className: 'button-link', onClick: onClear },
				__('Clear filters', 'moda-interact')
			)
		)
	);
}
