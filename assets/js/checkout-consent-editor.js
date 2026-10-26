// Editor-only registration for the forced Woo Checkout Fields inner block.
(function () {
	'use strict';
	const wp = window.wp;
	if (!wp || !wp.blocks || !wp.element || !wp.blocks.registerBlockType) {
		return;
	}
	if (
		wp.blocks.getBlockType &&
		wp.blocks.getBlockType('moda-interact/checkout-consent')
	) {
		return;
	}
	const label =
		window.modaWooConsentEditorLabel ||
		'Send me WhatsApp shopping updates, reminders and offers.';
	wp.blocks.registerBlockType('moda-interact/checkout-consent', {
		title: label,
		category: 'woocommerce',
		parent: ['woocommerce/checkout-fields-block'],
		attributes: {
			lock: {
				type: 'object',
				default: { remove: true, move: true },
			},
		},
		edit: () =>
			wp.element.createElement(
				'p',
				{ className: 'moda-woo-consent-editor-preview' },
				label
			),
		save: () => null,
	});
})();
