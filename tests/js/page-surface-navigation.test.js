import { describe, expect, it, vi } from 'vitest';
import { SurfaceNavigation } from '../../src/page/surface-navigation';

function buttons(element) {
	return element.props.children;
}

describe('connected merchant navigation', () => {
	it('keeps Overview, Billing, and Recovery Settings accessible', () => {
		const onSelect = vi.fn();
		const tabs = SurfaceNavigation({
			activeSurface: 'RECOVERY',
			onSelect,
		});
		const options = buttons(tabs);
		expect(tabs.props.role).toBe('tablist');
		expect(options).toHaveLength(3);
		expect(options.map((button) => button.props.role)).toEqual([
			'tab',
			'tab',
			'tab',
		]);
		expect(options.map((button) => button.props['aria-selected'])).toEqual([
			false,
			false,
			true,
		]);
		options[1].props.onClick();
		expect(onSelect).toHaveBeenCalledWith('BILLING');
	});
});
