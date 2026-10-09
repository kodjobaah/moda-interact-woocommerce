import { createElement, createRoot } from '@wordpress/element';
import ModaInteractPage from '../page';

/**
 * Mount only on the native Moda Interact screens, never unrelated WordPress pages.
 *
 * @param {Document} documentObject WordPress admin document.
 * @param {typeof createRoot} createRootImpl React root factory.
 */
export function mountNativeAdmin(
	documentObject = globalThis.document,
	createRootImpl = createRoot
) {
	const target = documentObject?.getElementById('moda-interact-native-root');
	if (!target) {
		return false;
	}

	createRootImpl(target).render(createElement(ModaInteractPage));
	return true;
}
