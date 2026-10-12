import { createElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

const statuses = [
	['all', () => __('All statuses', 'moda-interact')],
	['ongoing', () => __('Ongoing', 'moda-interact')],
	['COMPLETED', () => __('Completed', 'moda-interact')],
	['EXPIRED', () => __('Expired', 'moda-interact')],
	['CANCELLED', () => __('Cancelled', 'moda-interact')],
];

function Field({ id, label, children, className = '' }) {
	return createElement(
		'label',
		{ className: `moda-recoveries__field ${className}`, htmlFor: id },
		createElement('span', null, label),
		children
	);
}

export function RecoveryFilterForm({
	filters,
	today,
	error,
	busy = false,
	onChange,
	onSubmit,
}) {
	return createElement(
		'form',
		{
			className: 'moda-recoveries__form',
			onSubmit,
			noValidate: true,
		},
		...['from', 'to'].map((field) =>
			createElement(
				Field,
				{
					key: field,
					id: `moda-recoveries-${field}`,
					label:
						field === 'from'
							? __('From', 'moda-interact')
							: __('To', 'moda-interact'),
				},
				createElement('input', {
					id: `moda-recoveries-${field}`,
					name: field,
					type: 'date',
					value: filters[field],
					max: today,
					required: true,
					'aria-invalid': error,
					'aria-describedby': error
						? 'moda-recoveries-date-error'
						: undefined,
					onChange: (event) => onChange(field, event.target.value),
				})
			)
		),
		createElement(
			Field,
			{
				id: 'moda-recoveries-search',
				label: __('Search customer', 'moda-interact'),
				className: 'moda-recoveries__field--search',
			},
			createElement('input', {
				id: 'moda-recoveries-search',
				name: 'q',
				type: 'search',
				maxLength: 100,
				value: filters.q,
				onChange: (event) => onChange('q', event.target.value),
			})
		),
		createElement(
			Field,
			{
				id: 'moda-recoveries-status',
				label: __('Status', 'moda-interact'),
			},
			createElement(
				'select',
				{
					id: 'moda-recoveries-status',
					name: 'status',
					value: filters.status,
					onChange: (event) => onChange('status', event.target.value),
				},
				...statuses.map(([value, label]) =>
					createElement('option', { value, key: value }, label())
				)
			)
		),
		createElement(
			'button',
			{
				type: 'submit',
				className: 'button button-primary moda-recoveries__apply',
				disabled: busy,
			},
			__('Apply filters', 'moda-interact')
		),
		error
			? createElement(
					'p',
					{
						id: 'moda-recoveries-date-error',
						className: 'moda-recoveries__validation',
						role: 'alert',
					},
					__(
						'Choose valid dates, up to 366 days, ending no later than today.',
						'moda-interact'
					)
				)
			: null
	);
}
