/**
 * Flat ESLint configuration for the WooCommerce merchant plugin.
 *
 * WooCommerce ESLint plugin v4 publishes a native flat-config array. Keep
 * its WordPress/WooCommerce rules rather than replacing them with a local
 * approximation or the removed legacy eslintrc preset.
 */
import woocommerce from '@woocommerce/eslint-plugin';

export default [
	{
		ignores: [
			'**/build/**',
			'**/dist/**',
			'**/node_modules/**',
			'**/vendor/**',
		],
	},
	...woocommerce.configs.recommended,
	{
		rules: {
			'react/react-in-jsx-scope': 'off',
			// This is the Moda Interact extension, not WooCommerce core.
			'@wordpress/i18n-text-domain': [
				'error',
				{ allowedTextDomain: 'moda-interact' },
			],
		},
	},
	{
		// The extension uses Vitest and node:test, not Jest. WooCommerce's
		// test preset would otherwise try to auto-detect an absent Jest install.
		files: ['tests/**/*.{js,jsx,mjs,cjs}'],
		rules: {
			'jest/no-deprecated-functions': 'off',
		},
	},
	{
		// Webpack's Node configuration intentionally uses CommonJS require().
		files: ['webpack.config.js'],
		rules: {
			'@typescript-eslint/no-require-imports': 'off',
		},
	},
];
