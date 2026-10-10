import { useEffect, useRef, useState } from '@wordpress/element';
import {
	initialMerchantSurface,
	isNativeMerchantPage,
} from '../native-admin/page-surface';
import { createPageActions } from './page-actions';
import { createPageControllers } from './controller-factory';
import { createControllerSession } from './controller-session';

const initialCategoryState = {
	status: 'IDLE',
	data: null,
	categoryId: '',
	mappingIds: [],
};

/** Wire controller state to React while leaving all transport in the controllers. */
export function useModaPageState() {
	const sessionRef = useRef(null);
	const [activeSurface, setActiveSurface] = useState(() =>
		initialMerchantSurface(globalThis.location?.search ?? '')
	);
	const [connectionState, setConnectionState] = useState({
		connection: { status: 'LOADING' },
		pendingAction: null,
		actionError: false,
	});
	const [merchantState, setMerchantState] = useState({ status: 'IDLE' });
	const [billingState, setBillingState] = useState({ status: 'IDLE' });
	const [readAccessState, setReadAccessState] = useState({ status: 'IDLE' });
	const [syncState, setSyncState] = useState({ status: 'IDLE' });
	const [categoryState, setCategoryState] = useState(initialCategoryState);
	const [recoverySummaryState, setRecoverySummaryState] = useState({
		status: 'IDLE',
		data: null,
	});

	useEffect(() => {
		const session = createControllerSession(createPageControllers(), {
			onConnection: setConnectionState,
			onMerchant: setMerchantState,
			onBilling: setBillingState,
			onReadAccess: setReadAccessState,
			onSync: setSyncState,
			onCategory: setCategoryState,
			onRecoverySummary: setRecoverySummaryState,
			onConnectionLost: () => {
				if (!isNativeMerchantPage(globalThis.location?.search ?? '')) {
					setActiveSurface('OVERVIEW');
				}
			},
		});
		sessionRef.current = session;
		session.start();
		return () => {
			sessionRef.current = null;
			session.dispose();
		};
	}, []);

	useEffect(() => {
		sessionRef.current?.controllers.billing.setActive(
			connectionState.connection.status === 'CONNECTED' &&
				activeSurface === 'BILLING'
		);
	}, [activeSurface, connectionState.connection.status]);

	useEffect(() => {
		if (
			isNativeMerchantPage(globalThis.location?.search ?? '') &&
			connectionState.connection.status === 'CONNECTED' &&
			activeSurface === 'RECOVERY'
		) {
			sessionRef.current?.controllers.category.refresh();
		}
	}, [activeSurface, connectionState.connection.status]);

	useEffect(() => {
		sessionRef.current?.controllers.recoverySummary.setActive(
			connectionState.connection.status === 'CONNECTED' &&
				activeSurface === 'RECOVERY'
		);
	}, [activeSurface, connectionState.connection.status]);

	// The hosted return is advisory. Refresh the retained WordPress Admin page on focus
	// and briefly poll pending grants; never infer approval from URL parameters.
	useEffect(() => {
		const refresh = () => {
			if (globalThis.document?.visibilityState !== 'hidden') sessionRef.current?.controllers.readAccess.refresh();
		};
		globalThis.addEventListener?.('focus', refresh);
		globalThis.document?.addEventListener?.('visibilitychange', refresh);
		return () => {
			globalThis.removeEventListener?.('focus', refresh);
			globalThis.document?.removeEventListener?.('visibilitychange', refresh);
		};
	}, []);

	useEffect(() => {
		if (readAccessState.grantStatus !== 'PENDING' ||
			connectionState.connection.status !== 'CONNECTED') return;
		let checks = 0;
		const interval = globalThis.setInterval?.(() => {
			if (++checks > 15) { globalThis.clearInterval(interval); return; }
			if (globalThis.document?.visibilityState !== 'hidden') sessionRef.current?.controllers.readAccess.refresh();
		}, 6000);
		return () => { if (interval !== undefined) globalThis.clearInterval?.(interval); };
	}, [readAccessState.grantStatus, connectionState.connection.status]);

	const actions = createPageActions(sessionRef, setActiveSurface);

	return {
		activeSurface,
		connectionState,
		merchantState,
		billingState,
		readAccessState,
		syncState,
		categoryState,
		recoverySummaryState,
		actions,
	};
}
