import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

function categoryName(value) {
	return value?.localizedDisplayName ?? __('Not selected', 'moda-interact');
}

export function CategoryProfileSummary({ profile }) {
	return createElement(
		'div',
		{ className: 'moda-interact-recovery__profile' },
		createElement(
			'dl',
			{ className: 'moda-interact-details' },
			createElement('dt', null, __('Active category', 'moda-interact')),
			createElement('dd', null, categoryName(profile.activeCategory)),
			createElement('dt', null, __('Pending category', 'moda-interact')),
			createElement('dd', null, categoryName(profile.pendingCategory)),
			createElement(
				'dt',
				null,
				__('Selection generation', 'moda-interact')
			),
			createElement(
				'dd',
				null,
				String(profile.pendingSelectionGeneration)
			),
			createElement(
				'dt',
				null,
				__('Active mapping count', 'moda-interact')
			),
			createElement('dd', null, String(profile.activeMappingIds.length))
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
