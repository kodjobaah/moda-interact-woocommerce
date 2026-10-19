import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { StoreProfileForm } from './store-profile-form';

/**
 * Independent native disclosure: does not control Merchant Knowledge.
 *
 * @param {Object} props Store category state and controller actions.
 */
export function StoreProfileAccordion(props) {
	const { state, ...actions } = props;
	const activeCategory = state?.data?.storeProfile?.activeCategory;
	const hasProfile = !!state?.data?.storeProfile;
	const label = hasProfile
		? (activeCategory?.localizedDisplayName ??
			__('Not selected', 'moda-interact'))
		: null;
	return createElement(
		'details',
		{
			id: 'store-profile',
			className: 'moda-interact-store-profile',
			'aria-labelledby': 'moda-interact-store-profile-title',
		},
		createElement(
			'summary',
			{ className: 'moda-interact-store-profile__heading' },
			createElement(
				'strong',
				{ id: 'moda-interact-store-profile-title' },
				__('Store profile', 'moda-interact')
			),
			label ? createElement('small', null, label) : null
		),
		createElement(
			'div',
			{ className: 'moda-interact-store-profile__body' },
			createElement(StoreProfileForm, { state, ...actions })
		)
	);
}
