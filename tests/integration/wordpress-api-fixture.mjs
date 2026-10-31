import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { bootstrapInternationalContext } from './bootstrap-international-context.mjs';
import { createBillingWordPressFixture } from './scenarios/billing-wordpress.mjs';
import { createConsentApiFixture } from './consent-api-fixture.mjs';

async function verifyChallenge(body, fetchWordPress) {
	assert.equal(typeof body.siteUrl, 'string');
	assert.match(
		body.attemptId,
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
	);
	assert.equal(Buffer.from(body.bootstrapSecret, 'base64url').length, 32);
	const nonce = randomBytes(32).toString('base64url');
	const callback = new URL(body.siteUrl);
	callback.pathname = `${callback.pathname.replace(/\/+$/, '')}/wp-json/moda-interact/v1/connection/challenge`;
	callback.search = new URLSearchParams({
		attempt_id: body.attemptId,
		nonce,
	}).toString();
	const response = await fetchWordPress(callback);
	assert.equal(
		response.status,
		200,
		'the real unauthenticated WordPress challenge route must answer'
	);
	assert.match(
		response.headers.get('content-type') ?? '',
		/^application\/json/i
	);
	const challenge = await response.json();
	assert.deepEqual(Object.keys(challenge).sort(), [
		'attemptId',
		'nonce',
		'proof',
	]);
	assert.equal(challenge.attemptId, body.attemptId);
	assert.equal(challenge.nonce, nonce);
	const expected = createHmac(
		'sha256',
		Buffer.from(body.bootstrapSecret, 'base64url')
	)
		.update(
			`moda-interact-connect-v1\n${body.attemptId}\n${nonce}\n${body.siteUrl}`,
			'utf8'
		)
		.digest('base64url');
	assert.equal(challenge.proof, expected);
}

export function createWordPressApiFixture({ fetchWordPress, getSiteUrl }) {
	const activityRequests = [];
	const shopBrandRequests = [];
	const acceptedShopBrandIds = new Set();
	let shopBrandResponseStatus = 200;
	const billing = createBillingWordPressFixture();
	const consent = createConsentApiFixture();
	let activityStatus = 202;
	let restoreResolveStatus = 404;
	let restoreResolveResponse = null;
	const restoreResolveRequests = [];
	let probeCount = 0;
	let connectCount = 0;
	let bootstrapCount = 0;
	let contextSyncAttempts = 0;
	let savedContext = null;
	let activeCategorySelection = null;
	let categoryGeneration = 0;
	let categorySelections = 0;

	async function handleRequest({
		url,
		request,
		response,
		bodyBytes,
		sendJson,
	}) {
		if (
			consent.handleRequest({
				url,
				request,
				response,
				bodyBytes,
				sendJson,
			})
		) {
			return true;
		}
		if (
			url.pathname === '/v1/woocommerce/shop-brand' &&
			request.method === 'POST'
		) {
			// The fixture enforces the frozen API-001 producer contract over real
			// HTTPS, including its installation-scoped authentication boundary.
			assert.equal(url.search, '');
			assert.equal(request.headers.cookie, undefined);
			assert.equal(request.headers['x-moda-installation-id'], 'install_wp_fixture');
			assert.equal(
				request.headers.authorization,
				`Bearer ${Buffer.alloc(32, connectCount).toString('base64url')}`
			);
			assert.match(request.headers['content-type'] ?? '', /^application\/json/i);
			assert.ok(bodyBytes.length <= 16384);
			const event = JSON.parse(bodyBytes.toString('utf8'));
			assert.deepEqual(Object.keys(event).sort(), [
				'brandName', 'coverImage', 'eventId', 'logo', 'observedAt',
				'schemaVersion', 'siteIcon',
			]);
			assert.equal(event.schemaVersion, 'woo.shop-brand.v1');
			assert.ok(event.brandName === null ||
				(typeof event.brandName === 'string' && [...event.brandName].length <= 160));
			assert.equal(event.coverImage, null);
			assert.match(event.observedAt,
				/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
			for (const role of ['logo', 'siteIcon']) {
				const source = event[role];
				if (source === null) continue;
				assert.deepEqual(Object.keys(source).sort(), [
					'altText', 'attachmentId', 'height', 'url', 'width',
				]);
				assert.ok(Number.isSafeInteger(source.attachmentId) && source.attachmentId > 0);
				assert.ok(source.altText === null ||
					(typeof source.altText === 'string' && [...source.altText].length <= 256));
				for (const dimension of ['height', 'width']) {
					assert.ok(source[dimension] === null ||
						(Number.isSafeInteger(source[dimension]) && source[dimension] > 0));
				}
				const asset = new URL(source.url);
				assert.equal(asset.protocol, 'https:');
				assert.equal(asset.username, '');
				assert.equal(asset.password, '');
				assert.equal(asset.hash, '');
			}
			const canonical = {
				brandName: event.brandName,
				logo: event.logo,
				siteIcon: event.siteIcon,
				coverImage: event.coverImage,
			};
			const digest = createHash('sha256')
				.update(`install_wp_fixture\0${JSON.stringify(canonical)}`)
				.digest('hex');
			assert.equal(event.eventId, `woo-brand-${digest}`);
			const httpStatus = shopBrandResponseStatus;
			const disposition = httpStatus === 200
				? (acceptedShopBrandIds.has(event.eventId) ? 'unchanged' : 'updated')
				: null;
			shopBrandRequests.push({ event, httpStatus, disposition });
			if (httpStatus === 200) {
				acceptedShopBrandIds.add(event.eventId);
				sendJson(response, 200, { status: disposition });
			} else {
				sendJson(response, httpStatus, { error: 'fixture_failure' });
			}
			return true;
		}

		if (
			url.pathname === '/v1/woocommerce/recovery-restore/resolve' &&
			request.method === 'POST'
		) {
			assert.equal(url.search, '');
			assert.equal(request.headers.cookie, undefined);
			assert.equal(request.headers['x-moda-installation-id'], 'install_wp_fixture');
			assert.match(request.headers.authorization ?? '', /^Bearer [A-Za-z0-9_-]{43}$/);
			assert.match(request.headers['content-type'] ?? '', /^application\/json/i);
			assert.ok(bodyBytes.length <= 4096);
			const payload = JSON.parse(bodyBytes.toString('utf8'));
			assert.deepEqual(Object.keys(payload).sort(), ['recoveryId', 'schemaVersion', 'token']);
			assert.equal(payload.schemaVersion, 'woo.restore.resolve.v1');
			assert.match(payload.recoveryId, /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,127}$/);
			assert.match(payload.token, /^[A-Za-z0-9_-]{43}$/);
			restoreResolveRequests.push({ recoveryId: payload.recoveryId, status: restoreResolveStatus });
			if (restoreResolveStatus === 200) {
				sendJson(response, 200, restoreResolveResponse);
			} else {
				sendJson(response, restoreResolveStatus, { error: 'restore_unavailable' });
			}
			return true;
		}

		if (
			url.pathname === '/v1/woocommerce/activity' &&
			request.method === 'POST'
		) {
			assert.equal(
				request.headers['x-moda-installation-id'],
				'install_wp_fixture'
			);
			assert.equal(request.headers.cookie, undefined);
			const payload = JSON.parse(bodyBytes.toString('utf8'));
			const event = payload.event ?? payload;
			assert.equal(event.schemaVersion, 'woo.activity.v1');
			if (
				['ORDER_PLACED', 'ORDER_PAID', 'ORDER_CANCELLED'].includes(
					event.eventType
				)
			) {
				assert.equal(event.checkout, undefined);
				assert.equal(event.shopId, undefined);
				assert.deepEqual(Object.keys(event.order ?? {}).sort(), [
					'checkoutKey',
					'orderId',
					'status',
				]);
				assert.equal(event.order.checkoutKey, event.checkoutKey);
				assert.match(event.order.orderId, /^[1-9][0-9]*$/);
				assert.match(event.order.status, /^[a-z][a-z0-9_-]{0,63}$/);
			}
			activityRequests.push({
				eventId: event.eventId,
				status: activityStatus,
				payload,
			});
			sendJson(
				response,
				activityStatus,
				activityStatus === 202
					? { status: 'accepted' }
					: { error: 'unavailable' }
			);
			return true;
		}

		if (
			url.pathname === '/v1/woocommerce/installations/connect' &&
			request.method === 'POST'
		) {
			assert.equal(request.headers.authorization, undefined);
			assert.equal(request.headers.cookie, undefined);
			assert.ok(bodyBytes.length <= 8192);
			const body = JSON.parse(bodyBytes.toString('utf8'));
			assert.deepEqual(Object.keys(body).sort(), [
				'attemptId',
				'bootstrapSecret',
				'siteUrl',
			]);
			await verifyChallenge(body, fetchWordPress);
			connectCount += 1;
			const credential = Buffer.alloc(32, connectCount).toString(
				'base64url'
			);
			sendJson(response, connectCount === 1 ? 201 : 200, {
				installationId: 'install_wp_fixture',
				shopId: 'shop_wp_fixture',
				canonicalSiteUrl: body.siteUrl,
				credential,
				credentialVersion: connectCount,
				connection: connectCount === 1 ? 'CREATED' : 'RECONNECTED',
			});
			return true;
		}

		if (
			url.pathname === '/v1/woocommerce/installation' &&
			request.method === 'GET'
		) {
			probeCount += 1;
			assert.equal(
				request.headers['x-moda-installation-id'],
				'install_wp_fixture'
			);
			assert.match(
				request.headers.authorization ?? '',
				/^Bearer [A-Za-z0-9_-]{43}$/
			);
			assert.equal(request.headers.cookie, undefined);
			if (probeCount === 1) {
				sendJson(response, 200, {
					installationId: 'install_wp_fixture',
					shopId: 'shop_wp_fixture',
					canonicalSiteUrl: getSiteUrl(),
					credentialVersion: 1,
				});
			} else if (probeCount === 2) {
				sendJson(response, 401, { error: 'unauthorized' });
			} else if (probeCount === 3) {
				sendJson(response, 500, { error: 'internal_error' });
			} else if (probeCount === 4) {
				sendJson(response, 200, {
					installationId: 'install_wp_fixture',
					shopId: 'shop_wp_fixture',
					canonicalSiteUrl: getSiteUrl(),
					credentialVersion: 2,
				});
			} else if (probeCount === 5) {
				response.writeHead(200, { 'content-type': 'application/json' });
				response.end('{broken');
			} else if (probeCount === 6) {
				response.writeHead(200, {
					'content-type': 'application/json',
					'content-length': '8193',
				});
				response.end(`${' '.repeat(8193)}`);
			} else if (probeCount === 7) {
				response.writeHead(302, {
					location: 'https://elsewhere.invalid/',
				});
				response.end();
			} else if (probeCount === 8) {
				setTimeout(() => sendJson(response, 200, {}), 6500).unref();
			} else {
				sendJson(response, 200, {
					installationId: 'install_wp_fixture',
					shopId: 'shop_wp_fixture',
					canonicalSiteUrl: getSiteUrl(),
					credentialVersion: 2,
				});
			}
			return true;
		}

		if (
			url.pathname === '/v1/merchant/store-context' &&
			request.method === 'PUT'
		) {
			assert.equal(url.search, '');
			assert.equal(
				request.headers['x-moda-installation-id'],
				'install_wp_fixture'
			);
			assert.equal(
				request.headers.authorization,
				`Bearer ${Buffer.alloc(32, 2).toString('base64url')}`
			);
			assert.equal(request.headers.cookie, undefined);
			assert.ok(bodyBytes.length <= 2048);
			const snapshot = JSON.parse(bodyBytes.toString('utf8'));
			assert.deepEqual(Object.keys(snapshot).sort(), [
				'countryCode',
				'languageTag',
				'schemaVersion',
				'storeLocale',
				'timeZone',
			]);
			contextSyncAttempts += 1;
			if (contextSyncAttempts === 1) {
				sendJson(response, 503, { error: 'internal_error' });
			} else {
				savedContext = snapshot;
				response.writeHead(204, { 'cache-control': 'no-store' });
				response.end();
			}
			return true;
		}

		if (
			url.pathname === '/v1/merchant/store-categories' &&
			request.method === 'GET'
		) {
			assert.match(url.search, /^\?locale=[A-Za-z0-9_%\-]+$/);
			assert.equal(bodyBytes.length, 0);
			assert.equal(
				request.headers['x-moda-installation-id'],
				'install_wp_fixture'
			);
			assert.equal(
				request.headers.authorization,
				`Bearer ${Buffer.alloc(32, 2).toString('base64url')}`
			);
			const category = {
				id: 'fashion',
				slug: 'fashion',
				localizedDisplayName: 'Fashion',
				localizedDescription: 'Clothing and accessories',
			};
			sendJson(response, 200, {
				schemaVersion: 1,
				requestedLocale: 'en_GB',
				resolvedLocale: 'en',
				categories: [
					{
						...category,
						mappings: [
							{
								id: 'clothing',
								conditionKey: 'is_clothing',
								localizedDisplayName: 'Clothing',
							},
						],
						defaultTemplate: {
							id: 'template_1',
							key: 'fashion',
							displayName: 'Fashion',
							editVersion: 1,
						},
					},
				],
				storeProfile: {
					activeCategory: activeCategorySelection ? category : null,
					pendingCategory: null,
					activeMappingIds:
						activeCategorySelection?.selectedMappingIds ?? [],
					pendingMappingIds: [],
					pendingSelectionGeneration: categoryGeneration,
					pendingSelectedAt: null,
					pendingState: 'NONE',
					pendingTemplate: null,
				},
			});
			return true;
		}

		if (
			url.pathname === '/v1/merchant/store-category' &&
			request.method === 'POST'
		) {
			assert.equal(url.search, '');
			assert.equal(
				request.headers['x-moda-installation-id'],
				'install_wp_fixture'
			);
			assert.equal(
				request.headers.authorization,
				`Bearer ${Buffer.alloc(32, 2).toString('base64url')}`
			);
			const selection = JSON.parse(bodyBytes.toString('utf8'));
			assert.deepEqual(Object.keys(selection).sort(), [
				'categoryId',
				'expectedPendingSelectionGeneration',
				'schemaVersion',
				'selectedMappingIds',
			]);
			if (
				selection.expectedPendingSelectionGeneration !==
				categoryGeneration
			) {
				sendJson(response, 409, { error: 'store_category_conflict' });
				return true;
			}
			assert.equal(selection.categoryId, 'fashion');
			categorySelections += 1;
			categoryGeneration += 1;
			activeCategorySelection = selection;
			sendJson(response, 200, {
				schemaVersion: 1,
				activeCategoryId: 'fashion',
				activePromptRevisionId: 'revision_1',
				activeMappingIds: [...selection.selectedMappingIds],
				pendingSelectionGeneration: categoryGeneration,
			});
			return true;
		}

		if (
			url.pathname === '/v1/merchant/bootstrap' &&
			request.method === 'GET'
		) {
			bootstrapCount += 1;
			assert.equal(
				url.search,
				'',
				'the authenticated bootstrap request must not contain tenant selectors'
			);
			assert.equal(
				request.headers['x-moda-installation-id'],
				'install_wp_fixture'
			);
			assert.equal(
				request.headers.authorization,
				`Bearer ${Buffer.alloc(32, 2).toString('base64url')}`
			);
			assert.equal(request.headers.cookie, undefined);
			assert.equal(bodyBytes.length, 0);
			if (bootstrapCount === 1) {
				sendJson(response, 200, {
					schemaVersion: 1,
					shop: {
						id: 'shop_wp_fixture',
						platform: 'WOOCOMMERCE',
						domain: 'https://merchant.example',
						onboardingCompleted: false,
						installedAt: '2026-10-03T12:00:00.000Z',
					},
					internationalContext:
						bootstrapInternationalContext(savedContext),
					storeProfile: {
						activeCategory: activeCategorySelection
							? {
									id: 'fashion',
									slug: 'fashion',
									displayName: 'Fashion',
								}
							: null,
						pendingCategory: {
							id: 'category_1',
							slug: 'apparel',
							displayName: 'Apparel',
						},
						pendingSelectionGeneration: 3,
						pendingSelectedAt: '2026-10-02T12:30:00Z',
					},
				});
			} else if (bootstrapCount === 2) {
				sendJson(response, 401, { error: 'unauthorized' });
			} else if (bootstrapCount === 3) {
				sendJson(response, 500, { error: 'private provider detail' });
			} else if (bootstrapCount === 4) {
				sendJson(response, 200, {
					schemaVersion: 999,
					private: 'must not be relayed',
				});
			} else {
				sendJson(response, 200, {
					schemaVersion: 1,
					shop: {
						id: 'shop_wp_fixture',
						platform: 'WOOCOMMERCE',
						domain: 'https://merchant.example',
						onboardingCompleted: false,
						installedAt: '2026-10-03T12:00:00.000Z',
					},
					internationalContext:
						bootstrapInternationalContext(savedContext),
					storeProfile: {
						activeCategory: activeCategorySelection
							? {
									id: 'fashion',
									slug: 'fashion',
									displayName: 'Fashion',
								}
							: null,
						pendingCategory: {
							id: 'category_1',
							slug: 'apparel',
							displayName: 'Apparel',
						},
						pendingSelectionGeneration: 3,
						pendingSelectedAt: '2026-10-02T12:30:00Z',
					},
				});
			}
			return true;
		}

		return billing.handleRequest({
			url,
			request,
			response,
			bodyBytes,
			sendJson,
		});
	}

	return {
		handleRequest,
		getActivityRequests: () => activityRequests,
		getShopBrandRequests: () => [...shopBrandRequests],
		setShopBrandStatus: (status) => {
			assert.ok([200, 400, 408, 429, 503].includes(status));
			shopBrandResponseStatus = status;
		},
		setActivityStatus: (status) => {
			activityStatus = status;
		},
		consent,
		getRestoreResolveRequests: () => [...restoreResolveRequests],
		setRestoreResolveResult: (status, payload = null) => {
			assert.ok([200, 404, 503].includes(status));
			assert.ok(status !== 200 || payload !== null);
			restoreResolveStatus = status;
			restoreResolveResponse = payload;
		},
		assertExpectedBillingRequestCounts: billing.assertExpectedRequestCounts,
		getState: () => ({
			contextSyncAttempts,
			savedContext,
			categoryGeneration,
			categorySelections,
			...billing.counts(),
		}),
	};
}
