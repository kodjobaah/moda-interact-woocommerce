import { createElement } from '@wordpress/element';
import { RecoverySettingsHeader } from './recovery-settings-header';
import { RecoveryBehaviourPanel } from './recovery-behaviour-panel';
import { WhatsAppConsentGuidance } from './whatsapp-consent-guidance';
import { FeaturePreferencesPanel } from './feature-preferences-panel';
import { StoreAssistantContext } from './store-assistant-context';
import { StoreProfileAccordion } from './store-profile-accordion';
import { MerchantKnowledgePanel } from './merchant-knowledge/knowledge-panel';

/**
 * Compose Recovery Settings without owning category or knowledge form state.
 *
 * @param {Object} props Component state and callbacks.
 */
export function RecoverySettingsScreen(props) {
	const {
		state,
		onRefresh,
		onChoose,
		onToggleMapping,
		onSave,
		summaryState,
		onRefreshSummary,
		policyState,
		onRefreshPolicy,
		onSavePolicy,
		featurePreferencesState,
		onRefreshFeatures,
		onToggleFeature,
		knowledgeState,
		onRefreshKnowledge,
		onKnowledgeAction,
	} = props;
	return createElement(
		'section',
		{
			className: 'moda-interact-recovery',
			'aria-labelledby': 'moda-interact-recovery-heading',
			'aria-busy': ['LOADING', 'SAVING', 'VERIFYING'].includes(
				state.status
			),
		},
		createElement(RecoverySettingsHeader, {
			summaryState,
			onRefreshSummary,
		}),
		createElement(RecoveryBehaviourPanel, {
			policyState,
			onRefreshPolicy,
			onSavePolicy,
		}),
		createElement(WhatsAppConsentGuidance, {
			featurePreferencesState,
		}),
		createElement(FeaturePreferencesPanel, {
			state: featurePreferencesState,
			onRefresh: onRefreshFeatures,
			onToggle: onToggleFeature,
		}),
		createElement(StoreAssistantContext, {
			storeProfile: createElement(StoreProfileAccordion, {
				state,
				onRefresh,
				onChoose,
				onToggleMapping,
				onSave,
			}),
			merchantKnowledge: createElement(MerchantKnowledgePanel, {
				state: knowledgeState,
				onRefresh: onRefreshKnowledge,
				onAction: onKnowledgeAction,
			}),
		})
	);
}
