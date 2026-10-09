import { describe, expect, it, vi } from 'vitest';
import { RecoverySummaryController } from '../../src/recovery-summary-controller';

const summary = {
	schemaVersion: 1,
	recoveryDelayMinutes: 30,
	recoveryOfferMode: 'NONE',
	followUpEnabled: false,
	followUpDelayMinutes: null,
	source: 'MERCHANT',
};

describe('read-only effective recovery summary lifecycle', () => {
	it('fetches only for the active, connected Recovery Settings screen', async () => {
		const read = vi.fn().mockResolvedValue(summary);
		const controller = new RecoverySummaryController({ read });
		controller.setConnectionStatus('CONNECTED');
		expect(read).not.toHaveBeenCalled();
		controller.setActive(true);
		await controller.refresh();
		expect(read).toHaveBeenCalledTimes(1);
		expect(controller.state).toEqual({ status: 'READY', data: summary });
		controller.setActive(false);
		controller.dispose();
	});

	it('shows unavailable on failure without injecting fallback values or changing connection', async () => {
		const controller = new RecoverySummaryController({
			read: vi.fn().mockRejectedValue(new Error('down')),
		});
		controller.setConnectionStatus('CONNECTED');
		controller.setActive(true);
		await controller.refresh();
		expect(controller.state).toEqual({ status: 'ERROR', data: null });
		controller.dispose();
	});
});
