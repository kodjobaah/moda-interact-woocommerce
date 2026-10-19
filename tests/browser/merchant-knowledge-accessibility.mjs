import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

let server;
let browser;
let fixtureUrl;

before(async () => {
	server = await createServer({
		root: fileURLToPath(new URL('../../', import.meta.url)),
		configFile: false,
		logLevel: 'error',
		server: { host: '127.0.0.1', port: 0 },
	});
	await server.listen();
	const address = server.httpServer.address();
	fixtureUrl = `http://127.0.0.1:${address.port}/tests/fixtures/merchant-knowledge-browser.html`;
	try {
		browser = await chromium.launch({ headless: true });
	} catch (error) {
		try {
			// Use the developer's installed Chrome if Playwright Chromium has
			// not been downloaded (no dependency on a WordPress installation).
			browser = await chromium.launch({
				channel: 'chrome',
				headless: true,
			});
		} catch {
			throw new Error(
				`A Chromium browser is required for the UI checks. Run npx playwright install chromium. Original error: ${error.message}`
			);
		}
	}
});

after(async () => {
	await browser?.close();
	await server?.close();
});

async function openFixture(status, viewport = { width: 1200, height: 850 }) {
	const page = await browser.newPage({ viewport });
	await page.goto(`${fixtureUrl}?status=${status}`);
	await page.locator('#merchant-knowledge > summary').waitFor();
	return page;
}

test('native disclosures respond to Enter and Space; unavailable sources and forms remain honest', async () => {
	const page = await openFixture('UNAVAILABLE');
	try {
		const merchant = page.locator('#merchant-knowledge');
		const outerSummary = merchant.locator(':scope > summary');
		assert.equal(await merchant.evaluate((node) => node.open), false);
		await outerSummary.focus();
		await page.keyboard.press('Enter');
		assert.equal(await merchant.evaluate((node) => node.open), true);
		await page.keyboard.press('Enter');
		assert.equal(await merchant.evaluate((node) => node.open), false);
		await page.keyboard.press('Enter');
		assert.equal(await merchant.evaluate((node) => node.open), true);

		const web = page.locator('.moda-knowledge__disclosure').first();
		const webSummary = web.locator('summary');
		await webSummary.focus();
		await page.keyboard.press('Space');
		assert.equal(await web.evaluate((node) => node.open), false);
		await page.keyboard.press('Enter');
		assert.equal(await web.evaluate((node) => node.open), true);

		assert.equal(
			await page.locator('.moda-knowledge__disclosure').count(),
			2
		);
		assert.equal(
			await page.locator('.moda-knowledge__sources-placeholder').count(),
			1
		);
		assert.equal(await page.locator('.moda-knowledge__source').count(), 0);
		const enabledControls = page.locator(
			'.moda-knowledge__add-grid input:not(:disabled), ' +
				'.moda-knowledge__add-grid select:not(:disabled), ' +
				'.moda-knowledge__add-grid button:not(:disabled)'
		);
		assert.equal(await enabledControls.count(), 0);
		assert.ok(
			await page.locator('.moda-knowledge__add-grid input').count()
		);
		const content = await merchant.innerText();
		assert.match(content, /Knowledge sources could not be loaded/);
		assert.doesNotMatch(
			content,
			/0 of 0 sources configured|No knowledge sources configured/
		);
	} finally {
		await page.close();
	}
});

test('denied state stays fail-closed rather than displaying source controls', async () => {
	const page = await openFixture('DENIED');
	try {
		await page.locator('#merchant-knowledge > summary').click();
		assert.equal(
			await page.locator('.moda-knowledge__disclosure').count(),
			0
		);
		assert.equal(
			await page.locator('.moda-knowledge__sources-placeholder').count(),
			0
		);
		assert.equal(await page.locator('.moda-knowledge__source').count(), 0);
		assert.match(
			await page.locator('#merchant-knowledge').innerText(),
			/permission/
		);
	} finally {
		await page.close();
	}
});

test('real source component and SCSS stack forms and fields at narrow widths', async () => {
	const page = await openFixture('READY');
	try {
		await page.locator('#merchant-knowledge > summary').click();
		const form = page.locator('.moda-knowledge__form--web');
		const columns = async () =>
			form.evaluate(
				(node) =>
					globalThis
						.getComputedStyle(node)
						.gridTemplateColumns.trim()
						.split(/\s+/).length
			);
		assert.equal(await columns(), 3);

		await page.setViewportSize({ width: 390, height: 800 });
		assert.equal(await columns(), 1);
		const formContainer = page.locator('.moda-knowledge__add-grid');
		assert.equal(
			await formContainer.evaluate(
				(node) =>
					globalThis
						.getComputedStyle(node)
						.gridTemplateColumns.trim()
						.split(/\s+/).length
			),
			1
		);
		const disclosures = page.locator('.moda-knowledge__disclosure');
		const webBounds = await disclosures.nth(0).boundingBox();
		const uploadBounds = await disclosures.nth(1).boundingBox();
		assert.ok(uploadBounds.y >= webBounds.y + webBounds.height);
		const viewport = await page.evaluate(() => ({
			scrollWidth: globalThis.document.documentElement.scrollWidth,
			innerWidth: globalThis.innerWidth,
		}));
		assert.ok(
			viewport.scrollWidth <= viewport.innerWidth + 1,
			`Horizontal overflow: ${viewport.scrollWidth}px at ${viewport.innerWidth}px viewport`
		);
	} finally {
		await page.close();
	}
});

test('permanent context and independent native disclosures retain drafts', async () => {
	const page = await openFixture('READY');
	try {
		const context = page.locator('.moda-interact-store-context');
		const profile = page.locator('#store-profile');
		const knowledge = page.locator('#merchant-knowledge');
		assert.equal(await context.locator(':scope > summary').count(), 0);
		assert.equal(
			await context.locator(':scope > header > h2').innerText(),
			'Store & assistant context'
		);
		assert.equal(await profile.evaluate((node) => node.open), false);
		assert.equal(await knowledge.evaluate((node) => node.open), false);
		assert.match(
			await profile.locator(':scope > summary').innerText(),
			/Animals & Pet Supplies/
		);
		assert.match(
			await knowledge.locator(':scope > summary').innerText(),
			/0 of 3 sources configured/
		);

		await profile.locator(':scope > summary').focus();
		await page.keyboard.press('Enter');
		assert.equal(await profile.evaluate((node) => node.open), true);
		assert.equal(await knowledge.evaluate((node) => node.open), false);

		await knowledge.locator(':scope > summary').focus();
		await page.keyboard.press('Space');
		assert.equal(await knowledge.evaluate((node) => node.open), true);
		assert.equal(await profile.evaluate((node) => node.open), true);

		const draft = knowledge.locator('input[name="name"]').first();
		await draft.fill('Unsaved local draft');
		await knowledge.locator(':scope > summary').click();
		assert.equal(await knowledge.evaluate((node) => node.open), false);
		assert.equal(await profile.evaluate((node) => node.open), true);
		await knowledge.locator(':scope > summary').click();
		assert.equal(await draft.inputValue(), 'Unsaved local draft');
	} finally {
		await page.close();
	}
});
