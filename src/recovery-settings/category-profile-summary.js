import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

function categoryName(value) {
	return value?.localizedDisplayName ?? __('Not selected', 'moda-interact');
}

function stat(label, value) {
	return createElement(
		'div',
		{ className: 'moda-interact-recovery__profile-stat' },
		createElement('dt', null, label),
		createElement('dd', null, value)
	);
}

export function CategoryProfileSummary({ profile }) {
	return createElement(
		'div',
		{ className: 'moda-interact-recovery__profile' },
		createElement(
			'dl',
			{ className: 'moda-interact-recovery__profile-grid' },
			stat(
				__('Active category', 'moda-interact'),
				categoryName(profile.activeCategory)
			),
			stat(
				__('Pending category', 'moda-interact'),
				categoryName(profile.pendingCategory)
			),
			stat(
				__('Selection generation', 'moda-interact'),
				String(profile.pendingSelectionGeneration)
			),
			stat(
				__('Active mapping count', 'moda-interact'),
				String(profile.activeMappingIds.length)
			)
		),
		profile.pendingState === 'PENDING_PUBLICATION'
			? createElement(
					'p',
					{ className: 'moda-interact-message', role: 'status' },
					__(
						'A category change is pending publication.',
						'moda-interact'
					)
				)
			: null,
		profile.pendingTemplate
			? createElement(
					'p',
					null,
					__('Pending prompt template:', 'moda-interact'),
					' ',
					profile.pendingTemplate.displayName
				)
			: null
	);
}
