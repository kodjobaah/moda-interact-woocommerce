import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

export const DATE_PRESETS = [
	['TODAY', () => __('Today', 'moda-interact')],
	['WEEK', () => __('Last 7 days', 'moda-interact')],
	['MONTH', () => __('Last 30 days', 'moda-interact')],
	['CUSTOM', () => __('Custom dates', 'moda-interact')],
];

/**
 * Date-only values, never a browser-local timestamp sent to a hosted API.
 *
 * @param {Date}        date     - Date to display.
 * @param {string|null} timeZone - Merchant IANA time zone, if known.
 * @return {string} Date-only ISO value.
 */
export function dateInTimeZone(date, timeZone) {
	try {
		const parts = new Intl.DateTimeFormat('en-GB', {
			timeZone: timeZone || 'UTC',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		}).formatToParts(date);
		const part = (name) => parts.find((item) => item.type === name)?.value;
		return `${part('year')}-${part('month')}-${part('day')}`;
	} catch {
		return date.toISOString().slice(0, 10);
	}
}

export function presetDates(preset, today) {
	let days = 29;
	if (preset === 'TODAY') {
		days = 0;
	} else if (preset === 'WEEK') {
		days = 6;
	}
	const start = new Date(`${today}T12:00:00Z`);
	start.setUTCDate(start.getUTCDate() - days);
	return { from: start.toISOString().slice(0, 10), to: today };
}

export function RecoveryDatePresets({ selected, onSelect }) {
	return createElement(
		'div',
		{
			className: 'moda-recoveries__presets',
			role: 'group',
			'aria-label': __('Custom dates', 'moda-interact'),
		},
		...DATE_PRESETS.map(([value, label]) =>
			createElement(
				'button',
				{
					key: value,
					type: 'button',
					className:
						selected === value
							? 'moda-recoveries__preset is-active'
							: 'moda-recoveries__preset',
					'aria-pressed': selected === value,
					onClick: () => onSelect(value),
				},
				label()
			)
		)
	);
}
