import { createServer } from 'node:net';

/**
 * Ask the operating system for an available host port, then release it for
 * Docker's published WordPress port. This avoids fixed-port collisions across
 * wp-env projects; Docker still owns the final bind during `wp-env start`.
 */
export async function availableWpEnvHostPort() {
	const server = createServer();
	try {
		await new Promise((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, resolve);
		});
		const address = server.address();
		if (!address || typeof address === 'string') {
			throw new Error('Could not allocate a wp-env host port');
		}
		return address.port;
	} finally {
		if (server.listening) {
			await new Promise((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve()))
			);
		}
	}
}
