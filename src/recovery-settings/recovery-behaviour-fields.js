import { createElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { RecoveryOfferChoices } from './recovery-offer-choices';

/**
 * @param {Object} root0
 * @param {number} root0.number
 * @param {string} root0.title
 * @param {string} root0.description
 */
function StepHeading({ number, title, description }) {
	return createElement(
		'header',
		{ className: 'moda-recovery-behaviour__step-heading' },
		createElement('span', { 'aria-hidden': 'true' }, String(number)),
		createElement(
			'div',
			null,
			createElement('h3', null, title),
			createElement('p', null, description)
		)
	);
}

/**
 * @param {Object}                  root0
 * @param {string}                  root0.name
 * @param {string}                  root0.value
 * @param {number}                  root0.min
 * @param {boolean}                 root0.error
 * @param {boolean}                 root0.disabled
 * @param {(value: string) => void} root0.onChange
 */
function MinutesInput({ name, value, min, error, disabled, onChange }) {
	return createElement(
		'div',
		{ className: 'moda-recovery-behaviour__number-control' },
		createElement('input', {
			id: `woo-recovery-${name}`,
			type: 'number',
			min,
			max: 10080,
			step: 1,
			value,
			'aria-invalid': error || undefined,
			'aria-describedby': error
				? `woo-recovery-${name}-error`
				: undefined,
			disabled,
			onChange: (event) => onChange(event.currentTarget.value),
		}),
		error
			? createElement(
					'p',
					{ id: `woo-recovery-${name}-error`, role: 'alert' },
					name === 'recoveryDelayMinutes'
						? __(
								'Enter a whole number of minutes between 0 and 10,080.',
								'moda-interact'
							)
						: __(
								'Enter a whole number of minutes between 60 and 10,080.',
								'moda-interact'
							)
				)
			: null
	);
}

/**
 * Pure presentation; fixture tests may render this without invoking hooks.
 *
 * @param {Object}                                       root0
 * @param {Object|null}                                  root0.effective
 * @param {Object|undefined}                             root0.couponPreview
 * @param {Object}                                       root0.draft
 * @param {{start: boolean, followUp: boolean}}          root0.errors
 * @param {boolean}                                      root0.ready
 * @param {(key: string, value: string|boolean) => void} root0.onChange
 */
export function RecoveryBehaviourFields({
	couponPreview,
	effective,
	draft,
	errors,
	ready,
	onChange,
}) {
	return createElement(
		'div',
		{ className: 'moda-recovery-behaviour__sections' },
		createElement(
			'section',
			{ className: 'moda-recovery-behaviour__section' },
			createElement(StepHeading, {
				number: 1,
				title: __('Recovery offer', 'moda-interact'),
				description: __(
					'Discount assistance follows the offer choice below, for both Free and Paid plans. Follow-ups remain separately chargeable.',
					'moda-interact'
				),
			}),
			couponPreview ??
				createElement(RecoveryOfferChoices, {
					activeMode: effective?.recoveryOfferMode ?? null,
				})
		),
		createElement(
			'section',
			{ className: 'moda-recovery-behaviour__section' },
			createElement(StepHeading, {
				number: 2,
				title: __('Recovery start', 'moda-interact'),
				description: __(
					'Start recovery after (minutes) of checkout inactivity',
					'moda-interact'
				),
			}),
			createElement(
				'div',
				{ className: 'moda-recovery-behaviour__setting-row' },
				createElement(
					'div',
					{ className: 'moda-recovery-behaviour__field' },
					createElement(
						'label',
						{ htmlFor: 'woo-recovery-recoveryDelayMinutes' },
						__(
							'Start recovery after (minutes) of checkout inactivity',
							'moda-interact'
						)
					),
					createElement(MinutesInput, {
						name: 'recoveryDelayMinutes',
						value: draft.recoveryDelayMinutes,
						min: 0,
						error: errors.start,
						disabled: !ready,
						onChange: (value) =>
							onChange('recoveryDelayMinutes', value),
					})
				),
				createElement(
					'div',
					{
						className: 'moda-recovery-behaviour__effective',
						role: 'status',
					},
					effective
						? sprintf(
								/* translators: %d: effective recovery delay in minutes. */
								__(
									'Effective value: %d minutes',
									'moda-interact'
								),
								effective.recoveryDelayMinutes
							)
						: __('Unavailable', 'moda-interact')
				)
			)
		),
		createElement(
			'section',
			{ className: 'moda-recovery-behaviour__section' },
			createElement(StepHeading, {
				number: 3,
				title: __('No-response follow-up', 'moda-interact'),
				description: __(
					'Send one follow-up when the customer has not replied',
					'moda-interact'
				),
			}),
			createElement(
				'div',
				{ className: 'moda-recovery-behaviour__setting-row' },
				createElement(
					'label',
					{ className: 'moda-recovery-behaviour__toggle' },
					createElement('input', {
						type: 'checkbox',
						checked: draft.followUpEnabled,
						disabled: !ready,
						onChange: (event) =>
							onChange(
								'followUpEnabled',
								event.currentTarget.checked
							),
					}),
					__(
						'Send one follow-up when the customer has not replied',
						'moda-interact'
					)
				),
				createElement(
					'div',
					{ className: 'moda-recovery-behaviour__field' },
					createElement(
						'label',
						{ htmlFor: 'woo-recovery-followUpDelayMinutes' },
						__('After (minutes)', 'moda-interact')
					),
					createElement(MinutesInput, {
						name: 'followUpDelayMinutes',
						value: draft.followUpDelayMinutes,
						min: 60,
						error: errors.followUp,
						disabled: !ready || !draft.followUpEnabled,
						onChange: (value) =>
							onChange('followUpDelayMinutes', value),
					})
				)
			),
			createElement(
				'p',
				{ className: 'moda-recovery-behaviour__credit-note' },
				__(
					'If the customer replies, continuing the recovery conversation does not use another recovery credit. If Moda sends the scheduled follow-up, that follow-up is a new proactive recovery attempt and uses another recovery credit. Follow-up timing is measured from the last proactive recovery message sent.',
					'moda-interact'
				)
			)
		)
	);
}
