import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const script = readFileSync(join(repo, 'assets/js/checkout-consent-blocks-status.js'), 'utf8');
const fields = readFileSync(join(repo, 'includes/Checkout/CheckoutConsentCheckbox.php'), 'utf8');
const capture = readFileSync(join(repo, 'includes/Checkout/CheckoutConsentCapture.php'), 'utf8');

test('one Woo native optional contact field replaces the failed custom child block', () => {
	assert.match(fields, /woocommerce_register_additional_checkout_field/);
	assert.match(fields, /'location' => 'contact'/);
	assert.match(fields, /'required' => false/);
	assert.match(fields, /'optionalLabel' => \$disclosure\['text'\]/);
	assert.equal(existsSync(join(repo, 'assets/blocks/checkout-consent/block.json')), false);
	assert.doesNotMatch(script, /registerCheckoutBlock|createRoot/);
});

test('native field never authorises a checkout-field GRANT or REVOKE', () => {
	assert.match(fields, /'sanitize_callback' => static fn\( mixed \$value \): bool => false/);
	assert.doesNotMatch(capture, /add_action\( 'woocommerce_store_api_checkout_update_draft'/);
	assert.doesNotMatch(capture, /function blocksFromRequest/);
	assert.match(script, /action,\s*requestId/);
	assert.match(script, /data-moda-consent-control/);
});

test('Blocks script never emits checkout errors, customer data or separate withdrawal button', () => {
	assert.doesNotMatch(script, /window\.alert|window\.confirm|window\.fetch|console\.error/);
	assert.doesNotMatch(script, /grantEventId|canonicalPhone|installationId|Bearer /);
	assert.doesNotMatch(script, /document\.createElement|innerHTML/);
});
