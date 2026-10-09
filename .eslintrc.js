module.exports = {
	extends: ['plugin:@woocommerce/eslint-plugin/recommended'],
	rules: {
		'react/react-in-jsx-scope': 'off',
	},
	overrides: [
		{
			files: ['tests/integration/*.test.mjs'],
			rules: {
				'vitest/no-import-node-test': 'off',
			},
		},
	],
};
