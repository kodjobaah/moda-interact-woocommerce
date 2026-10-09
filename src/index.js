/**
 * External dependencies
 */
import { addFilter } from '@wordpress/hooks';
import { __ } from '@wordpress/i18n';
import ModaInteractPage from './page';
import { mountNativeAdmin } from './native-admin/mount';

/**
 * Internal dependencies
 */
import './index.scss';

addFilter('woocommerce_admin_pages_list', 'moda-interact', (pages) => {
	pages.push({
		container: ModaInteractPage,
		path: '/moda-interact',
		breadcrumbs: [__('Moda Interact', 'moda-interact')],
		navArgs: {
			id: 'moda-interact',
		},
	});

	return pages;
});

// The existing wc-admin route is retained for previously bookmarked links.
mountNativeAdmin();
