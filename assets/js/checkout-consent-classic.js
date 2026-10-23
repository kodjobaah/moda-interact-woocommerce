/* global jQuery */
// Use Woo's supported order-review refresh, never an unauthenticated direct consent POST.
// The PHP hook verifies Woo's request nonce and the current checkout session.
(function ($) {
	'use strict';
	if (!$) {
		return;
	}
	$(document.body).on(
		'change',
		'input[name="moda_interact_whatsapp_recovery_opt_in"]',
		function () {
			$(document.body).trigger('update_checkout');
		}
	);
})(typeof jQuery === 'undefined' ? null : jQuery);
