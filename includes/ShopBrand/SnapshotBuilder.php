<?php

namespace ModaInteract\WooCommerce\ShopBrand;

defined( 'ABSPATH' ) || exit;

/** The documented API-001 woo.shop-brand.v1 contract, without installation secrets. */
final class SnapshotBuilder {
	public function __construct( private readonly ?SourceReader $reader = null ) {}

	public function capture( string $installation_id ): array {
		return $this->build( $installation_id, ( $this->reader ?? new SourceReader() )->read() );
	}

	public function build( string $installation_id, array $source, ?string $observed_at = null ): array {
		$canonical = array(
			'brandName'  => $source['brandName'] ?? null,
			'logo'       => $source['logo'] ?? null,
			'siteIcon'   => $source['siteIcon'] ?? null,
			'coverImage' => null,
		);
		$encoded = wp_json_encode( $canonical, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
		if ( '' === $installation_id || ! is_string( $encoded ) || strlen( $encoded ) > 15000 ) {
			throw new \InvalidArgumentException( 'invalid_shop_brand_source' );
		}
		$now = new \DateTimeImmutable( 'now', new \DateTimeZone( 'UTC' ) );
		$event = array_merge( array(
			'schemaVersion' => 'woo.shop-brand.v1',
			'eventId'       => 'woo-brand-' . hash( 'sha256', $installation_id . "\0" . $encoded ),
			'observedAt'    => $observed_at ?? $now->format( 'Y-m-d\TH:i:s.v\Z' ),
		), $canonical );
		if ( ! self::valid( $event ) ) {
			throw new \InvalidArgumentException( 'invalid_shop_brand_snapshot' );
		}
		return $event;
	}

	public static function valid( array $event ): bool {
		$keys = array_keys( $event );
		sort( $keys );
		$expected = array( 'schemaVersion', 'eventId', 'observedAt', 'brandName', 'logo', 'siteIcon', 'coverImage' );
		sort( $expected );
		if ( $keys !== $expected || 'woo.shop-brand.v1' !== $event['schemaVersion'] ||
			! is_string( $event['eventId'] ) ||
			! preg_match( '/^woo-brand-[a-f0-9]{64}$/D', $event['eventId'] ) ||
			! is_string( $event['observedAt'] ) ||
			! preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/D', $event['observedAt'] ) ||
			( null !== $event['brandName'] && ( ! is_string( $event['brandName'] ) ||
				! self::boundedText( $event['brandName'], 160 ) ) ) ||
			null !== $event['coverImage'] ) {
			return false;
		}
		foreach ( array( 'logo', 'siteIcon' ) as $role ) {
			$media = $event[ $role ];
			if ( null === $media ) {
				continue;
			}
			if ( ! is_array( $media ) || ! self::exactMediaKeys( $media ) ||
				! SourceReader::httpsUrl( $media['url'] ) ||
				! is_int( $media['attachmentId'] ) || $media['attachmentId'] < 1 ||
				( null !== $media['altText'] && ( ! is_string( $media['altText'] ) || ! self::boundedText( $media['altText'], 256 ) ) ) ||
				( null !== $media['width'] && ( ! is_int( $media['width'] ) || $media['width'] < 1 ) ) ||
				( null !== $media['height'] && ( ! is_int( $media['height'] ) || $media['height'] < 1 ) ) ) {
				return false;
			}
		}
		return true;
	}

	private static function exactMediaKeys( array $media ): bool {
		$keys = array_keys( $media );
		$expected = array( 'url', 'attachmentId', 'altText', 'width', 'height' );
		sort( $keys );
		sort( $expected );
		return $keys === $expected;
	}

	private static function boundedText( string $value, int $max ): bool {
		return preg_match_all( '/./us', $value, $matches ) !== false && count( $matches[0] ) <= $max;
	}
}
