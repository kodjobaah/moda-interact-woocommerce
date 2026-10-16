import { createElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { SupportMessageCard } from './support-message-card';

export function SupportThread({ state, onRefresh, onPage, canRead }) {
  const { status, items, page, totalPages } = state;
  const notice = status === 'UNAVAILABLE'
    ? __('Support messages are not yet available for WooCommerce.', 'moda-interact')
    : status === 'DENIED' ? __('You do not have permission to view support messages.', 'moda-interact')
    : status === 'LOADING' ? __('Loading…', 'moda-interact')
      : status === 'ERROR' ? __('Support messages could not be loaded.', 'moda-interact')
        : status === 'READY' && items.length === 0 ? __('No messages yet.', 'moda-interact') : null;
  return createElement('section', { className: 'moda-support__panel', 'aria-labelledby': 'moda-support-thread' },
    createElement('div', { className: 'moda-support__section-title' },
      createElement('h2', { id: 'moda-support-thread' }, __('Support thread', 'moda-interact')),
      createElement('button', { type: 'button', className: 'button', onClick: onRefresh,
        disabled: !canRead || status === 'LOADING' }, __('Refresh', 'moda-interact'))),
    notice ? createElement('p', { role: ['ERROR', 'DENIED'].includes(status) ? 'alert' : 'status' }, notice) : null,
    status === 'ERROR' && canRead ? createElement('button', { className: 'button', type: 'button',
      onClick: onRefresh }, __('Retry', 'moda-interact')) : null,
    status === 'READY' && items.length ? createElement('ol', { className: 'moda-support__thread' },
      ...items.map((message) => createElement(SupportMessageCard, { key: message.id, message }))) : null,
    createElement('nav', { className: 'moda-support__pager', 'aria-label': __('Support pages', 'moda-interact') },
      createElement('button', { type: 'button', className: 'button-link',
        disabled: status !== 'READY' || page <= 1, onClick: () => onPage(page - 1) },
        __('Previous', 'moda-interact')),
      status === 'READY' && totalPages > 0 ? createElement('span', null,
        sprintf(__('Page %1$s of %2$s', 'moda-interact'), page, totalPages)) : null,
      createElement('button', { type: 'button', className: 'button-link',
        disabled: status !== 'READY' || page >= totalPages, onClick: () => onPage(page + 1) },
        __('Next', 'moda-interact')))
  );
}
