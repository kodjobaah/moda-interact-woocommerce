(function () {
	'use strict';
	const config = window.ModaWooCheckoutEngagement;
	if (
		!config ||
		typeof config.url !== 'string' ||
		typeof config.nonce !== 'string' ||
		typeof config.wpNonce !== 'string'
	) {
		return;
	}
	const surface = document.querySelector(
		'.woocommerce-cart, .woocommerce-checkout, .wp-block-woocommerce-cart, .wp-block-woocommerce-checkout'
	);
	if (!surface) {
		return;
	}
	let sent = false;

	function recordTrustedInteraction(event) {
		if (sent || !event.isTrusted || !surface.contains(event.target)) {
			return;
		}
		const target =
			event.target instanceof window.Element ? event.target : null;
		if (
			!target ||
			!target.closest(
				'a, button, input, select, textarea, [role="button"]'
			)
		) {
			return;
		}
		sent = true;
		fetch(config.url, {
			method: 'POST',
			credentials: 'same-origin',
			keepalive: true,
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': config.wpNonce,
			},
			body: JSON.stringify({ nonce: config.nonce }),
		}).catch(function () {
			// Checkout capture failures are diagnosed privately by the server.
		});
	}

	['click', 'change', 'keydown'].forEach(function (name) {
		surface.addEventListener(name, recordTrustedInteraction, {
			capture: true,
		});
	});
})();
