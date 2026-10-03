<?php

namespace ModaInteract\WooCommerce\Connection;

defined( 'ABSPATH' ) || exit;

use ModaInteract\WooCommerce\Api\ModaApiClient;
use ModaInteract\WooCommerce\Security\Base64Url;

final class ConnectionCoordinator {
	public function __construct(
		private readonly SiteIdentity $site_identity,
		private readonly BootstrapAttemptStore $attempt_store,
		private readonly InstallationStore $installation_store,
		private readonly ModaApiClient $api_client
	) {
	}

	public function connect(): array {
		$site_url  = $this->site_identity->assertConnectionPrerequisites();
		$attempt_id = self::uuidV4();
		$secret     = random_bytes( 32 );
		$encoded    = Base64Url::encode( $secret );
		if ( ! $this->attempt_store->create( $attempt_id, $encoded, $site_url ) ) {
			throw new ConnectionCoordinatorException( 'remote_unavailable' );
		}

		try {
			$remote = $this->api_client->connect( $site_url, $attempt_id, $encoded );
			$record = array(
				'schemaVersion'     => 1,
				'installationId'   => $remote['installationId'],
				'shopId'           => $remote['shopId'],
				'canonicalSiteUrl' => $remote['canonicalSiteUrl'],
				'credential'       => $remote['credential'],
				'credentialVersion'=> $remote['credentialVersion'],
				'connectedAt'      => gmdate( 'c' ),
			);
			if ( ! $this->installation_store->save( $record ) ) {
				throw new ConnectionCoordinatorException( 'local_persistence_failed' );
			}
			return array(
				'status'           => 'CONNECTED',
				'installationId'   => $record['installationId'],
				'shopId'           => $record['shopId'],
				'canonicalSiteUrl' => $record['canonicalSiteUrl'],
				'credentialVersion'=> $record['credentialVersion'],
				'connection'       => $remote['connection'],
			);
		} finally {
			$this->attempt_store->remove( $attempt_id );
		}
	}

	private static function uuidV4(): string {
		$bytes    = random_bytes( 16 );
		$bytes[6] = chr( ( ord( $bytes[6] ) & 0x0f ) | 0x40 );
		$bytes[8] = chr( ( ord( $bytes[8] ) & 0x3f ) | 0x80 );
		$hex      = bin2hex( $bytes );
		return substr( $hex, 0, 8 ) . '-' . substr( $hex, 8, 4 ) . '-' . substr( $hex, 12, 4 ) . '-' . substr( $hex, 16, 4 ) . '-' . substr( $hex, 20 );
	}
}

final class ConnectionCoordinatorException extends \RuntimeException {
}