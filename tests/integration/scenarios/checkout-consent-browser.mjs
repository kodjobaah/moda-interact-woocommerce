import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Actual Chromium hydration of Woo's saved Checkout Fields inner block. The
// real Store API + controlled HTTPS fixture remain active in run-wordpress.mjs.
// This is opt-in because Chromium installation is an extra local prerequisite.
export async function assertCheckoutConsentBrowser({
	siteUrl,
	page: pageId,
	product,
	consent,
}) {
	const browser = await chromium.launch({ headless: true });
	try {
		const context = await browser.newContext();
		const page = await context.newPage();
		const initialCount = consent.getRequests().length;
		await page.goto(new URL(`/?add-to-cart=${product}`, siteUrl).href);
		await page.goto(new URL(`/?page_id=${pageId}`, siteUrl).href);
		const root = page.locator(
			'[data-block-name="moda-interact/checkout-consent"]'
		);
		await root.waitFor({ state: 'visible', timeout: 20000 });
		const checkbox = root.locator('input[type="checkbox"]');
		await checkbox.waitFor({ state: 'visible', timeout: 20000 });
		assert.equal(
			await root.count(),
			1,
			'Exactly one React Blocks consent renderer'
		);
		assert.equal(
			await checkbox.count(),
			1,
			'Exactly one customer opt-in checkbox'
		);
		assert.equal(
			await checkbox.isChecked(),
			false,
			'Hydration must not auto-opt-in'
		);
		assert.equal(
			consent.getRequests().length,
			initialCount,
			'Opening checkout must not publish consent'
		);
		const checkoutFields = root.locator(
			'xpath=ancestor::*[contains(@class,"wp-block-woocommerce-checkout-fields-block")]'
		);
		assert.equal(
			await checkoutFields.count(),
			1,
			'Consent belongs to the checkout fields, not order totals'
		);

		const phone = page
			.locator(
				'#billing-phone, input[name="billing_phone"], input[autocomplete="tel"]'
			)
			.first();
		await phone.waitFor({ state: 'visible', timeout: 15000 });
		await phone.fill('+447400123456');
		await phone.blur();
		await checkbox.waitFor({ state: 'visible', timeout: 15000 });
		const before = consent.getRequests().length;
		await checkbox.click();
		await page.waitForFunction(
			() =>
				!!document.querySelector(
					'[data-block-name="moda-interact/checkout-consent"] button'
				),
			null,
			{ timeout: 20000 }
		);
		assert.equal(
			consent.getRequests().length,
			before + 1,
			'One deliberate browser click sends one GRANT'
		);
		assert.equal(consent.getRequests().at(-1).event.decision, 'GRANT');
		const withdraw = root.getByRole('button', {
			name: /Withdraw WhatsApp permission/i,
		});
		assert.equal(await withdraw.count(), 1);
		page.once('dialog', async (dialog) => dialog.accept());
		await withdraw.click();
		await checkbox.waitFor({ state: 'visible', timeout: 20000 });
		assert.equal(
			await checkbox.isChecked(),
			false,
			'REVOKE ACK returns to neutral opt-in'
		);
		assert.equal(consent.getRequests().length, before + 2);
		assert.equal(consent.getRequests().at(-1).event.decision, 'REVOKE');
		assert.doesNotMatch(
			await root.innerHTML(),
			/grantEventId|canonicalPhone|credential/,
			'Checkout DOM must not reveal hosted proof or installation secret'
		);
		await context.close();
	} finally {
		await browser.close();
	}
}
