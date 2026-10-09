import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('WooCommerce Admin page registration', () => {
	it('uses the same navigation ID in PHP and JavaScript', () => {
		const php = readFileSync(
			new URL('../../includes/Admin/Setup.php', import.meta.url),
			'utf8'
		);
		const js = readFileSync(
			new URL('../../src/index.js', import.meta.url),
			'utf8'
		);
		const registered = php.match(/'id'\s*=>\s*'([^']+)'/);
		const navigation = js.match(/navArgs:\s*\{\s*id:\s*'([^']+)'/);

		expect(registered?.[1]).toBe('moda-interact');
		expect(navigation?.[1]).toBe(registered?.[1]);
		expect(js).toContain("path: '/moda-interact'");
	});
});
