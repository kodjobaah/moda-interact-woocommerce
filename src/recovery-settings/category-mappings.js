import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

export function CategoryMappings({
	mappings,
	selectedIds,
	disabled,
	onToggle,
}) {
	if (mappings.length === 0) {
		return createElement(
			'p',
			{ className: 'moda-interact-overview__empty' },
			__(
				'No optional taxonomy mappings are available for this category.',
				'moda-interact'
			)
		);
	}
	return createElement(
		'fieldset',
		{ className: 'moda-interact-recovery__mappings', disabled },
		createElement(
			'legend',
			null,
			__('Optional taxonomy mappings', 'moda-interact')
		),
		mappings.map((mapping) =>
			createElement(
				'label',
				{ key: mapping.id },
				createElement('input', {
					type: 'checkbox',
					checked: selectedIds.includes(mapping.id),
					onChange: () => onToggle(mapping.id),
				}),
				' ',
				mapping.localizedDisplayName
			)
		)
	);
}
