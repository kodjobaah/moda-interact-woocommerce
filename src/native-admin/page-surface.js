import { isBillingReturn } from '../billing-controller';

const nativeSurfaces = {
	'moda-interact': 'OVERVIEW',
	'moda-interact-billing': 'BILLING',
	'moda-interact-recovery-settings': 'RECOVERY',
};

export function isNativeMerchantPage(search = '') {
	return Object.hasOwn(
		nativeSurfaces,
		new URLSearchParams(search).get('page')
	);
}

/**
 * Native menu destinations take precedence over legacy WooCommerce return URLs.
 *
 * @param {string} search Current location search string.
 */
export function initialMerchantSurface(search = '') {
	const slug = new URLSearchParams(search).get('page');
	if (Object.hasOwn(nativeSurfaces, slug)) {
		return nativeSurfaces[slug];
	}
	return isBillingReturn(search) ? 'BILLING' : 'OVERVIEW';
}
