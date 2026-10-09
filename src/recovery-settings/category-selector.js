import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { CategoryMappings } from './category-mappings';

export function CategorySelector({
	categories,
	categoryId,
	mappingIds,
	disabled,
	onChoose,
	onToggle,
}) {
	const selected = categories.find((category) => category.id === categoryId);
	return createElement(
		'div',
		{ className: 'moda-interact-recovery__selection' },
		createElement(
			'label',
			{ htmlFor: 'moda-interact-store-category' },
			__('Store category', 'moda-interact')
		),
		createElement(
			'select',
			{
				id: 'moda-interact-store-category',
				value: categoryId,
				disabled,
				onChange: (event) => onChoose(event.target.value),
			},
			createElement(
				'option',
				{ value: '' },
				__('Select a store category', 'moda-interact')
			),
			categories.map((category) =>
				createElement(
					'option',
					{ key: category.id, value: category.id },
					category.localizedDisplayName
				)
			)
		),
		selected
			? createElement(
					'p',
					{ className: 'moda-interact-recovery__description' },
					selected.localizedDescription
				)
			: null,
		selected
			? createElement(CategoryMappings, {
					mappings: selected.mappings,
					selectedIds: mappingIds,
					disabled,
					onToggle,
				})
			: null
	);
}
