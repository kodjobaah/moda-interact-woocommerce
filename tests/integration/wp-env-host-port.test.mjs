/* eslint vitest/no-import-node-test: "off" */

import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';
import { availableWpEnvHostPort } from './wp-env-host-port.mjs';

function listen(server) {
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, resolve);
	});
}

function close(server) {
	return new Promise((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve()))
	);
}

test('allocates a valid, bindable host port rather than a fixed port', async () => {
	const port = await availableWpEnvHostPort();
	assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
	const server = createServer();
	try {
		await new Promise((resolve, reject) => {
			server.once('error', reject);
			server.listen(port, resolve);
		});
		assert.equal(server.address().port, port);
	} finally {
		if (server.listening) {
			await close(server);
		}
	}
});

test('avoids a port actively reserved by another listener', async () => {
	const busyServer = createServer();
	try {
		await listen(busyServer);
		const busyPort = busyServer.address().port;
		const port = await availableWpEnvHostPort();
		assert.notEqual(port, busyPort);
	} finally {
		if (busyServer.listening) {
			await close(busyServer);
		}
	}
});
