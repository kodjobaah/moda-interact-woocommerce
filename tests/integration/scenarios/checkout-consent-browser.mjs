import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {
	safeConsentBrowserEvent,
	safeConsentBrowserSignals,
} from './checkout-consent-browser-signals.mjs';

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
		// Opt in only for this disposable Chromium context so the test can
		// distinguish a missing script from a rejected Woo block registration.
		// Never capture console details, which could contain checkout data.
		await page.addInitScript(() => {
			try {
				window.sessionStorage.setItem('modaWooConsentDebug', '1');
			} catch {
				// Storage restrictions are not a checkout failure.
			}
		});
		const registrationEvents = [];
		let pageErrorCount = 0;
		page.on('pageerror', () => {
			pageErrorCount++;
		});
		page.on('console', async (message) => {
			if (message.type() !== 'info') {
				return;
			}
			try {
				const parts = message.args();
				if (parts.length < 2) {
					return;
				}
				const event = safeConsentBrowserEvent(
					await parts[0].jsonValue(),
					await parts[1].jsonValue()
				);
				if (event && registrationEvents.length < 50) {
					registrationEvents.push(event);
				}
			} catch {
				// Browser telemetry must not change the test or checkout.
			}
		});
		const initialCount = consent.getRequests().length;
		await page.goto(new URL(`/?add-to-cart=${product}`, siteUrl).href);
		await page.goto(new URL(`/?page_id=${pageId}`, siteUrl).href);
		// WooCommerce owns the native checkbox; there is no custom inner
		// block placeholder or Moda React renderer to wait for.
		const checkbox = page.locator('input[data-moda-consent-control="1"]');
		try {
			await checkbox.waitFor({ state: 'visible', timeout: 20000 });
		} catch (error) {
			const runtime = await page.evaluate(() => ({
				consentScriptPresent: Array.from(document.scripts).some(
					(script) => script.src.includes('checkout-consent-blocks-status.js')
				),
				configPresent: !!window.modaWooCheckoutConsentConfig,
				wpDataPresent: typeof window.wp?.data?.select === 'function',
				nativeCheckboxVisible: !!document.querySelector(
					'input[data-moda-consent-control="1"]'
				),
				visibleConsentControls: document.querySelectorAll(
					'input[data-moda-consent-control="1"]'
				).length,
			}));
			throw new Error(
				`WooCommerce did not display its native consent checkbox: ${JSON.stringify(
					safeConsentBrowserSignals(runtime, registrationEvents, pageErrorCount)
				)}`,
				{ cause: error }
			);
		}
		assert.equal(await checkbox.count(), 1, 'Exactly one native consent checkbox');
		assert.equal(await checkbox.isChecked(), false, 'No inferred opt-in');
		assert.equal(consent.getRequests().length, initialCount, 'Loading never grants');
		const inOrderSummary = await checkbox.evaluate((input) =>
			!!input.closest('.wp-block-woocommerce-checkout-order-summary-block')
		);
		assert.equal(inOrderSummary, false, 'Consent is not inside order summary');

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
			() => document.querySelector('input[data-moda-consent-control="1"]')?.checked === true,
			null, { timeout: 20000 }
		);
		assert.equal(
			await checkbox.isChecked(),
			true,
			'GRANT ACK checks consent'
		);
		assert.equal(
			await checkbox.isEnabled(),
			true,
			'Verified consent can be deliberately unchecked'
		);
		assert.equal(await page.locator('[data-moda-consent-error]').count(), 0);
		assert.equal(
			consent.getRequests().length,
			before + 1,
			'One deliberate browser click sends one GRANT'
		);
		assert.equal(consent.getRequests().at(-1).event.decision, 'GRANT');
		assert.equal(await page.locator('#moda-woo-consent-withdraw').count(), 0);
		await checkbox.click();
		await page.waitForFunction(
			() => document.querySelector('input[data-moda-consent-control="1"]')?.checked === false,
			null, { timeout: 20000 }
		);
		await checkbox.waitFor({ state: 'visible', timeout: 20000 });
		assert.equal(
			await checkbox.isChecked(),
			false,
			'REVOKE ACK returns to neutral opt-in'
		);
		assert.equal(await checkbox.isEnabled(), true);
		assert.equal(await page.locator('[data-moda-consent-error]').count(), 0);
		assert.equal(consent.getRequests().length, before + 2);
		assert.equal(consent.getRequests().at(-1).event.decision, 'REVOKE');
		assert.doesNotMatch(
			await checkbox.evaluate((input) => input.outerHTML),
			/grantEventId|canonicalPhone|credential/,
			'Checkout DOM must not reveal hosted proof or installation secret'
		);
		await context.close();
	} finally {
		await browser.close();
	}
}

/** Native Classic checkout must also keep its optional checkbox visible. */
export async function assertClassicConsentBrowser({
	siteUrl,
	page: pageId,
	product,
	consent,
}) {
	const browser = await chromium.launch({ headless: true });
	try {
		const context = await browser.newContext();
		const page = await context.newPage();
		const before = consent.getRequests().length;
		await page.goto(new URL(`/?add-to-cart=${product}`, siteUrl).href);
		await page.goto(new URL(`/?page_id=${pageId}`, siteUrl).href);
		const checkbox = page.locator(
			'input[name="moda_interact_whatsapp_recovery_opt_in"]'
		);
		await checkbox.waitFor({ state: 'visible', timeout: 20000 });
		assert.equal(await checkbox.count(), 1);
		assert.equal(await checkbox.isChecked(), false);
		assert.equal(
			await page.locator('#moda-woo-consent-action-error').count(),
			0,
			'Consent errors must never render on the merchant checkout'
		);
		assert.equal(consent.getRequests().length, before);
		await context.close();
	} finally {
		await browser.close();
	}
}
