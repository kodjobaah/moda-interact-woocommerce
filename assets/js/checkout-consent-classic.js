/* global jQuery */
// Use Woo's supported order-review refresh, never an unauthenticated direct consent POST.
// The PHP hook verifies Woo's request nonce and the current checkout session.
(function ($) {
	'use strict';
	if (!$) {
		return;
	}
	const selectFields =
		'input[name="moda_interact_whatsapp_recovery_opt_in"], ' +
		'select[name="moda_interact_whatsapp_recovery_withdrawal"]';
	$(document.body).on('change', selectFields, function () {
		$(document.body).trigger('update_checkout');
	});
})(typeof jQuery === 'undefined' ? null : jQuery);
