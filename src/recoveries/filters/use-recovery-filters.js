import { useEffect, useRef, useState } from '@wordpress/element';
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
 * Draft filters are independent of the applied server-side query.
 *
 * @param {string|null} timeZone    Merchant IANA time zone, if known.
 * @param {Object|null} serverRange Initial authoritative dates returned by the API.
 * @return {Object} Local filters and callbacks.
 */
export function useRecoveryFilters(timeZone, serverRange = null) {
	const today = dateInTimeZone(new Date(), timeZone);
	const [filters, setFilters] = useState(() => initialRecoveryFilters(today));
	const [error, setError] = useState(false);
	const edited = useRef(false);
	const hasServerRange = serverRange !== null;
	const rangeFrom = serverRange?.from;
	const rangeTo = serverRange?.to;
	const rangeQuery = serverRange?.q;
	const rangeStatus = serverRange?.status;

	// Merchant timezone may arrive after connection/bootstrap. Preserve custom dates.
	useEffect(() => {
		setFilters((current) =>
			current.preset === 'CUSTOM'
				? current
				: { ...current, ...presetDates(current.preset, today) }
		);
	}, [today]);

	// The initial API read uses the store timezone, not the browser's UTC clock.
	// Never overwrite dates after the merchant edits the draft form.
	useEffect(() => {
		if (!hasServerRange || edited.current) {
			return;
		}
		setFilters((current) => ({
			...current,
			from: rangeFrom,
			to: rangeTo,
			q: rangeQuery ?? current.q,
			status: rangeStatus ?? current.status,
			preset:
				['TODAY', 'WEEK', 'MONTH'].find((preset) => {
					const range = presetDates(preset, today);
					return range.from === rangeFrom && range.to === rangeTo;
				}) ?? 'CUSTOM',
		}));
	}, [hasServerRange, rangeFrom, rangeTo, rangeQuery, rangeStatus, today]);

	const update = (field, value) => {
		if (!['from', 'to', 'q', 'status'].includes(field)) {
			return;
		}
		edited.current = true;
		setError(false);
		setFilters((current) => ({
			...current,
			[field]: field === 'q' ? value.slice(0, MAX_SEARCH_LENGTH) : value,
			preset:
				field === 'from' || field === 'to' ? 'CUSTOM' : current.preset,
		}));
	};

	const selectPreset = (preset) => {
		edited.current = true;
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
		edited.current = true;
		setFilters(initialRecoveryFilters(today));
		setError(false);
	};

	const submit = (event) => {
		event?.preventDefault?.();
		const valid = isValidDateRange(filters, today);
		setError(!valid);
		return valid;
	};

	return { filters, today, error, update, selectPreset, clear, submit };
}
