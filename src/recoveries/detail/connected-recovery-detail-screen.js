import { createElement } from '@wordpress/element';
import { RecoveryDetailScreen } from './recovery-detail-screen';
import { useRecoveryDetail } from './hooks/use-recovery-detail';
import {
	detailSummaryDisplay,
	detailMessagesDisplay,
	detailRelatedDisplay,
} from './recovery-detail-presentation';
import { recoveryDetailHref, readRecoveryListQuery } from './detail-navigation';

/**
 * Adapter only: presentation components never call WordPress REST.
 * @param {Object} root0
 * @param {Object} root0.route
 */
export function ConnectedRecoveryDetailScreen({ route }) {
	const controller = useRecoveryDetail(route.recoveryId);
	const { summary, messages, related } = controller.state;
	const timeZone = summary.status === 'READY' ? summary.data.timeZone : null;
	const query = readRecoveryListQuery(route.listHref.split('?')[1] ?? '');
	return createElement(RecoveryDetailScreen, {
		route,
		status: summary.status,
		detail:
			summary.status === 'READY'
				? detailSummaryDisplay(summary.data)
				: null,
		conversation: {
			state: summary.status === 'READY' ? messages.status : 'UNAVAILABLE',
			timeZone,
			messages:
				summary.status === 'READY' && messages.data
					? detailMessagesDisplay(messages.data.items, timeZone)
					: [],
			hasPrevious:
				messages.status === 'READY' &&
				Boolean(messages.data.previousCursor),
			hasNext:
				messages.status === 'READY' &&
				Boolean(messages.data.nextCursor),
			onPrevious:
				summary.status === 'READY'
					? controller.previousMessages
					: undefined,
			onNext:
				summary.status === 'READY'
					? controller.nextMessages
					: undefined,
			onJumpLatest:
				messages.status === 'READY' && messages.data.items.length > 0
					? controller.latestMessages
					: undefined,
			onRefresh:
				summary.status === 'READY'
					? controller.refreshMessages
					: undefined,
		},
		related: {
			state: summary.status === 'READY' ? related.status : 'UNAVAILABLE',
			items:
				summary.status === 'READY' && related.data
					? detailRelatedDisplay(related.data.items, timeZone)
					: [],
			hasPrevious:
				related.status === 'READY' &&
				Boolean(related.data.previousCursor),
			hasNext:
				related.status === 'READY' && Boolean(related.data.nextCursor),
			onPrevious:
				summary.status === 'READY'
					? controller.previousRelated
					: undefined,
			onNext:
				summary.status === 'READY' ? controller.nextRelated : undefined,
			onRefresh:
				summary.status === 'READY'
					? controller.refreshRelated
					: undefined,
			getHref: (id) => recoveryDetailHref(id, query),
		},
	});
}
