import { createElement, createRoot } from '@wordpress/element';
import ModaInteractPage from '../page';

/** Mount only on the native Moda Interact screens, never unrelated WordPress pages. */
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
