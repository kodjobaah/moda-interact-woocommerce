import { createElement } from '@wordpress/element';
import { RecoverySettingsHeader } from './recovery-settings-header';
import { RecoveryBehaviourPanel } from './recovery-behaviour-panel';
import { WhatsAppConsentGuidance } from './whatsapp-consent-guidance';
import { FeaturePreferencesPanel } from './feature-preferences-panel';
import { StoreAssistantContext } from './store-assistant-context';
import { StoreProfileAccordion } from './store-profile-accordion';
import { MerchantKnowledgePanel } from './merchant-knowledge/knowledge-panel';
import { AiResponseDelayPanel } from './ai-response-delay-panel';
import { StoreBrandPanel } from './store-brand-panel';

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
		aiResponseDelayState,
		onRefreshAiResponseDelay,
		onSaveAiResponseDelay,
		featurePreferencesState,
		onRefreshFeatures,
		onToggleFeature,
		knowledgeState,
		onRefreshKnowledge,
		onKnowledgeAction,
		shopBrandSyncState,
		onRefreshShopBrandSync,
		onSyncShopBrand,
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
		createElement(AiResponseDelayPanel, {
			state: aiResponseDelayState,
			onRefresh: onRefreshAiResponseDelay,
			onSave: onSaveAiResponseDelay,
		}),
		createElement(WhatsAppConsentGuidance, {
			featurePreferencesState,
		}),
		createElement(StoreBrandPanel, {
			state: shopBrandSyncState,
			onRefresh: onRefreshShopBrandSync,
			onSync: onSyncShopBrand,
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
