import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

const surfaces = [
	['OVERVIEW', __('Overview', 'moda-interact')],
	['BILLING', __('Billing', 'moda-interact')],
	['RECOVERY', __('Recovery Settings', 'moda-interact')],
];

// Connected merchant views share a single tab navigation.
export function SurfaceNavigation({ activeSurface, onSelect }) {
	return createElement(
		'div',
		{ className: 'moda-interact-surfaces__tabs', role: 'tablist' },
		...surfaces.map(([surface, label]) =>
			createElement(
				'button',
				{
					key: surface,
					type: 'button',
					role: 'tab',
					'aria-selected': activeSurface === surface,
					className:
						activeSurface === surface
							? 'button moda-interact-surfaces__tab is-active'
							: 'button moda-interact-surfaces__tab',
					onClick: () => onSelect(surface),
				},
				label
			)
		)
	);
}
