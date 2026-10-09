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
	const [syncState, setSyncState] = useState({ status: 'IDLE' });
	const [categoryState, setCategoryState] = useState(initialCategoryState);

	useEffect(() => {
		const session = createControllerSession(createPageControllers(), {
			onConnection: setConnectionState,
			onMerchant: setMerchantState,
			onBilling: setBillingState,
			onSync: setSyncState,
			onCategory: setCategoryState,
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

	const actions = createPageActions(sessionRef, setActiveSurface);

	return {
		activeSurface,
		connectionState,
		merchantState,
		billingState,
		syncState,
		categoryState,
		actions,
	};
}
