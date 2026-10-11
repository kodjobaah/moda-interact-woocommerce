import { useEffect, useState } from '@wordpress/element';
import { dateInTimeZone, presetDates } from './recovery-date-presets';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SEARCH_LENGTH = 100;

export function isValidDateRange({ from, to }, today) {
	if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to)) {
		return false;
	}
	const valid = (value) => {
		const parsed = new Date(`${value}T12:00:00Z`);
		return (
			!Number.isNaN(parsed.getTime()) &&
			parsed.toISOString().slice(0, 10) === value
		);
	};
	const length =
		(Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
		86400000;
	return (
		valid(from) && valid(to) && from <= to && to <= today && length <= 365
	);
}

export function initialRecoveryFilters(today) {
	return {
		...presetDates('MONTH', today),
		q: '',
		status: 'all',
		preset: 'MONTH',
	};
}

/**
 * UI-only filter state. The later API integration owns network submission.
 *
 * @param {string|null} timeZone Merchant IANA time zone, if known.
 * @return {Object} Local filters and callbacks.
 */
export function useRecoveryFilters(timeZone) {
	const today = dateInTimeZone(new Date(), timeZone);
	const [filters, setFilters] = useState(() => initialRecoveryFilters(today));
	const [error, setError] = useState(false);

	// Merchant timezone may arrive after connection/bootstrap. Preserve custom dates.
	useEffect(() => {
		setFilters((current) =>
			current.preset === 'CUSTOM'
				? current
				: { ...current, ...presetDates(current.preset, today) }
		);
	}, [today]);

	const update = (field, value) => {
		if (!['from', 'to', 'q', 'status'].includes(field)) {
			return;
		}
		setError(false);
		setFilters((current) => ({
			...current,
			[field]: field === 'q' ? value.slice(0, MAX_SEARCH_LENGTH) : value,
			preset:
				field === 'from' || field === 'to' ? 'CUSTOM' : current.preset,
		}));
	};

	const selectPreset = (preset) => {
		setError(false);
		setFilters((current) =>
			preset === 'CUSTOM'
				? { ...current, preset }
				: {
						...current,
						...presetDates(preset, today),
						preset,
					}
		);
	};

	const clear = () => {
		setFilters(initialRecoveryFilters(today));
		setError(false);
	};

	const submit = (event) => {
		event?.preventDefault?.();
		// No request or success message exists until the read API is connected.
		setError(!isValidDateRange(filters, today));
	};

	return { filters, today, error, update, selectPreset, clear, submit };
}
