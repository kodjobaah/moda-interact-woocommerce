import { createElement } from '@wordpress/element';
import { HumanModeControls } from './human-mode-controls';
import { HumanReplyComposer } from './human-reply-composer';
import { HumanCommandStatus } from './human-command-status';

/**
 * Compatibility wrapper for existing recovery-detail consumers.
 * @param {Object} root0
 * @param {Object} root0.summary
 * @param {Object} root0.human
 */
export function HumanConversationControls({ summary, human }) {
	return createElement(
		'div',
		{ className: 'moda-recovery-detail__human' },
		createElement(HumanModeControls, { summary, human }),
		createElement(HumanReplyComposer, { summary, human }),
		createElement(HumanCommandStatus, { human })
	);
}
