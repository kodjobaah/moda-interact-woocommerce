import { createElement, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

const systemActions = Object.freeze({
  BILLING_FREE_ALLOWANCE_WARNING: 'moda-interact-billing',
  BILLING_SUBSCRIPTION_ENDED: 'moda-interact-billing',
  BILLING_PLAN_UPGRADED: 'moda-interact-billing',
  BILLING_PLAN_DOWNGRADE_SCHEDULED: 'moda-interact-billing',
  BILLING_SAFETY_LIMIT_REACHED: 'moda-interact-billing',
});

/** Fixed first-party targets only; never render a provider-supplied href. */
export function supportSystemHref(message) {
  const page = message.kind === 'SYSTEM' ? systemActions[message.systemCode] : null;
  return page ? `admin.php?page=${page}` : null;
}

export function SupportMessageCard({ message }) {
  const [original, setOriginal] = useState(false);
  const sender = message.kind === 'MERCHANT' ? __('You', 'moda-interact')
    : message.kind === 'SYSTEM' ? __('System', 'moda-interact')
      : __('Moda Support', 'moda-interact');
  const translated = message.isTranslated === true &&
    typeof message.originalBody === 'string' && typeof message.displayBody === 'string';
  const notReady = message.kind !== 'MERCHANT' && message.displayBody == null;
  const href = supportSystemHref(message);
  return createElement('li', { className: `moda-support__message moda-support__message--${
    ['MERCHANT','SYSTEM','ADMINISTRATIVE'].includes(message.kind) ? message.kind.toLowerCase() : 'unknown'
  }` },
  createElement('div', { className: 'moda-support__message-head' },
    createElement('strong', null, sender),
    createElement('time', { dateTime: message.createdAt }, new Date(message.createdAt).toLocaleString()),
    !message.readAt && message.kind !== 'MERCHANT' && message.state === 'AVAILABLE'
      ? createElement('span', { className: 'moda-support__unread' }, __('Unread', 'moda-interact')) : null
  ),
  createElement('p', { dir: 'auto' }, notReady
    ? (message.state === 'FAILED' ? __('Translation unavailable', 'moda-interact')
      : __('Translation pending', 'moda-interact'))
    : (original ? message.originalBody : (message.displayBody ?? message.originalBody))),
  translated ? createElement('button', { type: 'button', className: 'button-link',
    onClick: () => setOriginal((value) => !value) },
    original ? __('View translation', 'moda-interact') : __('View original', 'moda-interact')) : null,
  href ? createElement('a', { href }, __('View billing', 'moda-interact')) : null);
}
