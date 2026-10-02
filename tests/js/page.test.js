import { isValidElement } from '@wordpress/element';
import { describe, expect, it } from 'vitest';
import ModaInteractPage from '../../src/page';

describe('Moda Interact foundation page', () => {
	it('renders the minimal WooCommerce extension content', () => {
		const page = ModaInteractPage();

		expect(isValidElement(page)).toBe(true);
		expect(page.type).toBe('main');
		expect(page.props.children[0].props.children).toBe('Moda Interact');
		expect(page.props.children[1].props.children).toBe(
			'WooCommerce extension foundation'
		);
	});
});
