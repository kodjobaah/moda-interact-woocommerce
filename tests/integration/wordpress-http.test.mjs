import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createWordPressFetch } from './wordpress-http.mjs';

test('forwards request details and avoids reusing keep-alive connections', async () => {
	let forwarded;
	const expected = { status: 204 };
	const wpFetch = createWordPressFetch(async (url, options) => {
		forwarded = { url, options };
		return expected;
	});

	assert.equal(
		await wpFetch('http://localhost:8899/wp-json/moda-interact/v1/billing', {
			method: 'POST',
			headers: { Cookie: 'private-cookie', 'X-WP-Nonce': 'private-nonce' },
			body: '{}',
		}),
		expected
	);
	assert.equal(forwarded.url, 'http://localhost:8899/wp-json/moda-interact/v1/billing');
	assert.equal(forwarded.options.method, 'POST');
	assert.equal(forwarded.options.body, '{}');
	assert.equal(forwarded.options.headers.get('cookie'), 'private-cookie');
	assert.equal(forwarded.options.headers.get('x-wp-nonce'), 'private-nonce');
	assert.equal(forwarded.options.headers.get('connection'), 'close');
});

test('reports a transport error with the method and path but no sensitive request details', async () => {
	const original = new TypeError('fetch failed', {
		cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
	});
	const wpFetch = createWordPressFetch(async () => {
		throw original;
	});

	await assert.rejects(
		wpFetch('http://localhost:8899/wp-json/moda-interact/v1/connection?nonce=private-nonce', {
			headers: { Cookie: 'private-cookie' },
		}),
		(error) => {
			assert.equal(error.cause, original);
			assert.equal(error.message, 'WordPress HTTP transport failed: GET /wp-json/moda-interact/v1/connection (UND_ERR_SOCKET)');
			assert.doesNotMatch(error.message, /private-(?:nonce|cookie)/);
			return true;
		}
	);
});

test('never retries failed stateful fixture requests', async () => {
	let called = 0;
	const wpFetch = createWordPressFetch(async () => {
		called += 1;
		throw Object.assign(new Error('temporary failure'), { code: 'ECONNRESET' });
	});

	await assert.rejects(
		wpFetch('http://localhost:8899/wp-json/moda-interact/v1/connection', { method: 'GET' }),
		/WordPress HTTP transport failed: GET/
	);
	assert.equal(called, 1);
});


test('uses Connection: close with a real localhost WordPress HTTP fixture', async () => {
	let connectionHeader;
	const server = createServer((request, response) => {
		connectionHeader = request.headers.connection;
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end('{"status":"CONNECTED"}');
	});
	await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
	try {
		const wpFetch = createWordPressFetch();
		const response = await wpFetch(
			`http://127.0.0.1:${server.address().port}/wp-json/moda-interact/v1/connection`,
			{ redirect: 'manual' }
		);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { status: 'CONNECTED' });
		assert.equal(connectionHeader, 'close');
	} finally {
		server.closeAllConnections();
		await new Promise((resolveClose) => server.close(resolveClose));
	}
});
