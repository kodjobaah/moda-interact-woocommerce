import { describe, expect, it, vi } from 'vitest';
import { RecoveryBehaviourFields } from '../../src/recovery-settings/recovery-behaviour-fields';
import { RecoveryOfferChoices } from '../../src/recovery-settings/recovery-offer-choices';
import {
	recoveryBehaviourPreview,
	validateRecoveryBehaviourPreview,
} from '../../src/recovery-settings/recovery-behaviour-validation';

const effective = {
	recoveryDelayMinutes: 30,
	recoveryOfferMode: 'NONE',
	followUpEnabled: false,
	followUpDelayMinutes: null,
	source: 'MERCHANT',
};
const policy = {
	merchant: { ...effective, recoveryDelayMinutes: 45 },
	effective,
	notifyOnInitialRecoveryOutreach: false,
};

function walk(node, visitor) {
	if (Array.isArray(node)) {
		node.forEach((child) => walk(child, visitor));
		return;
	}
	if (node === null || typeof node !== 'object') {
		return;
	}
	if (typeof node.type === 'function') {
		walk(node.type(node.props), visitor);
		return;
	}
	visitor(node);
	walk(node.props?.children, visitor);
}

function elements(root, type) {
	const found = [];
	walk(root, (node) => {
		if (node.type === type) {
			found.push(node);
		}
	});
	return found;
}

describe('Woo recovery behaviour preview (no settings write)', () => {
	it('initializes merchant settings and the top-level notification preference', () => {
		expect(recoveryBehaviourPreview(policy)).toEqual({
			recoveryDelayMinutes: '45',
			followUpEnabled: false,
			followUpDelayMinutes: '',
			notifyOnInitialRecoveryOutreach: false,
		});
		expect(recoveryBehaviourPreview(null).recoveryDelayMinutes).toBe('');
	});

	it('validates whole-minute recovery delays and conditional follow-up delays', () => {
		const draft = recoveryBehaviourPreview(policy);
		expect(validateRecoveryBehaviourPreview(draft)).toEqual({
			start: false,
			followUp: false,
		});
		expect(
			validateRecoveryBehaviourPreview({
				...draft,
				recoveryDelayMinutes: '1.5',
			}).start
		).toBe(true);
		expect(
			validateRecoveryBehaviourPreview({
				...draft,
				recoveryDelayMinutes: '10081',
			}).start
		).toBe(true);
		expect(
			validateRecoveryBehaviourPreview({
				...draft,
				followUpEnabled: true,
				followUpDelayMinutes: '59',
			}).followUp
		).toBe(true);
		expect(
			validateRecoveryBehaviourPreview({
				...draft,
				followUpEnabled: true,
				followUpDelayMinutes: '60',
			}).followUp
		).toBe(false);
	});

	it('shows the three offer choices without enabling unverified Woo coupon behaviour', () => {
		const view = RecoveryOfferChoices({ activeMode: 'NONE' });
		const radio = elements(view, 'input').filter(
			(node) => node.props.type === 'radio'
		);
		expect(radio).toHaveLength(3);
		expect(radio.every((node) => node.props.disabled)).toBe(true);
		expect(
			radio
				.filter((node) => node.props.checked)
				.map((node) => node.props.value)
		).toEqual(['NONE']);
	});

	it('renders responsive sections, preview input values and an inactive follow-up', () => {
		const onChange = vi.fn();
		const view = RecoveryBehaviourFields({
			effective,
			draft: recoveryBehaviourPreview(policy),
			errors: { start: false, followUp: false },
			ready: true,
			onChange,
		});
		const inputs = elements(view, 'input');
		const start = inputs.find(
			(input) => input.props.id === 'woo-recovery-recoveryDelayMinutes'
		);
		const followUp = inputs.find(
			(input) => input.props.id === 'woo-recovery-followUpDelayMinutes'
		);
		expect(start.props.value).toBe('30');
		expect(followUp.props.disabled).toBe(true);
		start.props.onChange({ currentTarget: { value: '45' } });
		expect(onChange).toHaveBeenCalledWith('recoveryDelayMinutes', '45');
		const notification = inputs.filter(
			(input) => input.props.type === 'checkbox'
		)[1];
		expect(notification).toBeDefined();
		notification.props.onChange({ currentTarget: { checked: true } });
		expect(onChange).toHaveBeenCalledWith('notifyOnInitialRecoveryOutreach', true);
	});

	it('shows inline invalid state only for the affected field', () => {
		const view = RecoveryBehaviourFields({
			effective,
			draft: {
				recoveryDelayMinutes: '-1',
				followUpDelayMinutes: '30',
				followUpEnabled: true,
			},
			errors: { start: true, followUp: true },
			ready: true,
			onChange: () => {},
		});
		expect(
			elements(view, 'input').filter((node) => node.props['aria-invalid'])
		).toHaveLength(2);
		expect(
			elements(view, 'p').filter((node) => node.props.role === 'alert')
		).toHaveLength(2);
	});
});
