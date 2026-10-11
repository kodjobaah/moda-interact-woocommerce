import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { RecoveryFilterForm } from '../../src/recoveries/filters/recovery-filter-form';
import {
	RecoveryDatePresets,
	dateInTimeZone,
	presetDates,
} from '../../src/recoveries/filters/recovery-date-presets';
import {
	initialRecoveryFilters,
	isValidDateRange,
} from '../../src/recoveries/filters/use-recovery-filters';
import { RecoveryFilterPanel } from '../../src/recoveries/filters/recovery-filter-panel';
import { RecoveryList } from '../../src/recoveries/list/recovery-list';
import { RecoveryRow } from '../../src/recoveries/list/recovery-row';
import { RecoveryResultsState } from '../../src/recoveries/states/recovery-results-state';
import { RecoveryPagination } from '../../src/recoveries/list/recovery-pagination';

function descendants(node, type) {
	if (Array.isArray(node)) {
		return node.flatMap((child) => descendants(child, type));
	}
	if (node === null || node === undefined || typeof node !== 'object') {
		return [];
	}
	if (typeof node.type === 'function') {
		return descendants(node.type(node.props), type);
	}
	return [
		...(node.type === type ? [node] : []),
		...descendants(node.props?.children, type),
	];
}

function words(node) {
	if (Array.isArray(node)) {
		return node.map(words).join(' ');
	}
	if (typeof node === 'string' || typeof node === 'number') {
		return String(node);
	}
	if (!node) {
		return '';
	}
	if (typeof node.type === 'function') {
		return words(node.type(node.props));
	}
	return words(node.props?.children);
}

const filters = {
	...initialRecoveryFilters('2026-10-11'),
	q: 'Jane',
};

describe('Recoveries UI-only shell', () => {
	it('keeps From, To, Search customer, Status, Apply filters in one desktop form', () => {
		const update = vi.fn();
		const submit = vi.fn();
		const form = RecoveryFilterForm({
			filters,
			today: '2026-10-11',
			error: false,
			onChange: update,
			onSubmit: submit,
		});
		expect(form.type).toBe('form');
		expect(form.props.className).toBe('moda-recoveries__form');
		expect(
			descendants(form, 'input').map((input) => input.props.name)
		).toEqual(['from', 'to', 'q']);
		expect(descendants(form, 'select')).toHaveLength(1);
		expect(descendants(form, 'button')[0].props.type).toBe('submit');
		expect(words(form)).toContain('Apply filters');
		const search = descendants(form, 'input').find(
			(input) => input.props.name === 'q'
		);
		expect(search.props.maxLength).toBe(100);
		search.props.onChange({ target: { value: 'Ada' } });
		expect(update).toHaveBeenCalledWith('q', 'Ada');
		expect(form.props.onSubmit).toBe(submit);
	});

	it('keeps date presets and Clear filters separate from the form and displays a known store timezone', () => {
		const choose = vi.fn();
		const clear = vi.fn();
		const panel = RecoveryFilterPanel({
			filters,
			today: '2026-10-11',
			error: false,
			timeZone: 'Europe/London',
			onChange: vi.fn(),
			onPreset: choose,
			onClear: clear,
			onSubmit: vi.fn(),
		});
		expect(words(panel)).toContain('Europe/London');
		const presets = RecoveryDatePresets({
			selected: 'MONTH',
			onSelect: choose,
		});
		const buttons = descendants(presets, 'button');
		expect(buttons).toHaveLength(4);
		expect(buttons[2].props['aria-pressed']).toBe(true);
		buttons[0].props.onClick();
		expect(choose).toHaveBeenCalledWith('TODAY');
		const clearButton = descendants(panel, 'button').find(
			(button) => words(button) === 'Clear filters'
		);
		clearButton.props.onClick();
		expect(clear).toHaveBeenCalledOnce();
	});

	it('validates calendar dates and uses merchant timezone in presets', () => {
		expect(
			dateInTimeZone(new Date('2026-10-11T00:30:00Z'), 'America/New_York')
		).toBe('2026-10-10');
		expect(presetDates('WEEK', '2026-10-11')).toEqual({
			from: '2026-10-05',
			to: '2026-10-11',
		});
		expect(presetDates('MONTH', '2026-03-01')).toEqual({
			from: '2026-01-31',
			to: '2026-03-01',
		});
		expect(
			isValidDateRange(
				{ from: '2026-09-12', to: '2026-10-11' },
				'2026-10-11'
			)
		).toBe(true);
		expect(
			isValidDateRange(
				{ from: '2026-10-12', to: '2026-10-11' },
				'2026-10-11'
			)
		).toBe(false);
		expect(
			isValidDateRange(
				{ from: '2026-02-30', to: '2026-10-11' },
				'2026-10-11'
			)
		).toBe(false);
		expect(
			isValidDateRange(
				{ from: '2025-01-01', to: '2026-10-11' },
				'2026-10-11'
			)
		).toBe(false);
		expect(
			isValidDateRange(
				{ from: '2026-10-01', to: '2026-11-11' },
				'2026-10-11'
			)
		).toBe(false);
	});

	it('does not fake recoveries on an unconnected page, including pagination and refresh', () => {
		const list = RecoveryList({ state: 'UNAVAILABLE' });
		expect(descendants(list, 'li')).toHaveLength(0);
		expect(words(list)).toContain('Recovery data is not connected.');
		expect(words(list)).not.toContain('No matching recoveries');
		const previousNext = descendants(RecoveryPagination({}), 'button');
		expect(previousNext).toHaveLength(2);
		expect(previousNext.every((button) => button.props.disabled)).toBe(
			true
		);
	});

	it('has distinct future loading, empty, failure and mock-data presentation states', () => {
		for (const [state, label] of [
			['LOADING', 'Loading recoveries'],
			['NEVER_USED', 'No recoveries yet'],
			['EMPTY', 'No matching recoveries'],
			['ERROR', 'Recoveries could not be loaded'],
		]) {
			expect(words(RecoveryResultsState({ state }))).toContain(label);
		}
		const fixture = {
			id: 'fixture-only',
			customerName: 'Ada Lovelace',
			customerEmail: 'ada@example.invalid',
			checkoutDate: 'Oct 9, 2026',
			status: 'COMPLETED',
			checkoutValue: '£89.99',
			startedAt: 'Oct 9, 2026',
		};
		const ready = RecoveryList({ state: 'READY', items: [fixture] });
		expect(descendants(ready, 'li')).toHaveLength(1);
		expect(words(RecoveryRow({ item: fixture }))).toContain('Ada Lovelace');
		expect(words(ready)).toContain('Completed');
	});

	it('has desktop five-column and tablet/mobile reflow rules', () => {
		const scss = readFileSync(
			new URL(
				'../../src/recoveries/styles/_recovery-filters.scss',
				import.meta.url
			),
			'utf8'
		);
		expect(scss).toMatch(
			/grid-template-columns:\s*minmax\(120px, 1fr\)\s*minmax\(120px, 1fr\)\s*minmax\(150px, 1\.6fr\)\s*minmax\(140px, 1fr\)\s*auto/s
		);
		expect(scss).toContain('@media (max-width: 960px)');
		expect(scss).toContain('@media (max-width: 600px)');
		const listingScss = readFileSync(
			new URL(
				'../../src/recoveries/styles/_recovery-list.scss',
				import.meta.url
			),
			'utf8'
		);
		expect(listingScss).toContain('@media (max-width: 600px)');
	});
});
