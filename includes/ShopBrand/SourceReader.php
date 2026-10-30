<?php

namespace ModaInteract\WooCommerce\ShopBrand;

defined( 'ABSPATH' ) || exit;

/** Reads only WordPress core Site Identity settings and image attachments. */
final class SourceReader {
	public function read(): array {
		$name = get_bloginfo( 'name' );
		return array(
			'brandName'  => self::text( $name, 160 ),
			'logo'       => $this->logo(),
			'siteIcon'   => $this->siteIcon(),
			'coverImage' => null, // WordPress does not provide a canonical cover image.
		);
	}

	/** Only the attachment selected by the active site's identity is relevant. */
	public function isSelectedAttachment( int $attachment_id ): bool {
		return $attachment_id > 0 && in_array( $attachment_id, array(
			$this->logoId(),
			self::attachmentId( get_option( 'site_icon', 0 ) ),
		), true );
	}

	private function logo(): ?array {
		return $this->attachment( $this->logoId(), false );
	}

	private function siteIcon(): ?array {
		return $this->attachment( self::attachmentId( get_option( 'site_icon', 0 ) ), true );
	}

	private function logoId(): int {
		// Do not resurrect an old theme's logo when the active source is removed.
		if ( function_exists( 'wp_is_block_theme' ) && wp_is_block_theme() ) {
			return self::attachmentId( get_option( 'site_logo', 0 ) );
		}
		return self::attachmentId( get_theme_mod( 'custom_logo', 0 ) );
	}

	private function attachment( int $id, bool $icon ): ?array {
		if ( $id < 1 ) {
			return null;
		}
		// A deleted/non-image attachment is absent, even if its setting still has an ID.
		$attachment_url = wp_get_attachment_image_url( $id, 'full' );
		if ( ! self::httpsUrl( $attachment_url ) ) {
			return null;
		}
		$url = $attachment_url;
		if ( $icon ) {
			$site_icon_url = get_site_icon_url();
			if ( is_string( $site_icon_url ) && '' !== $site_icon_url ) {
				// Never silently promote HTTP source URLs to HTTPS.
				if ( ! self::httpsUrl( $site_icon_url ) ) {
					return null;
				}
				$url = $site_icon_url;
			}
		}
		$metadata = wp_get_attachment_metadata( $id );
		$metadata = is_array( $metadata ) ? $metadata : array();
		return array(
			'url'          => $url,
			'attachmentId' => $id,
			'altText'      => self::text( get_post_meta( $id, '_wp_attachment_image_alt', true ), 256 ),
			'width'        => self::positiveInteger( $metadata['width'] ?? null ),
			'height'       => self::positiveInteger( $metadata['height'] ?? null ),
		);
	}

	public static function httpsUrl( mixed $url ): bool {
		if ( ! is_string( $url ) || '' === $url || strlen( $url ) > 2048 ||
			false === filter_var( $url, FILTER_VALIDATE_URL ) || preg_match( '/[\x00-\x20\x7f]/', $url ) ) {
			return false;
		}
		$parts = parse_url( $url );
		return is_array( $parts ) && 'https' === strtolower( (string) ( $parts['scheme'] ?? '' ) ) &&
			! empty( $parts['host'] ) && ! isset( $parts['user'] ) && ! isset( $parts['pass'] ) && ! isset( $parts['fragment'] );
	}

	private static function attachmentId( mixed $id ): int {
		if ( ! is_int( $id ) && ( ! is_string( $id ) || ! preg_match( '/^[1-9][0-9]*$/D', $id ) ) ) {
			return 0;
		}
		$number = (int) $id;
		return $number > 0 && (string) $number === (string) $id ? $number : 0;
	}

	private static function positiveInteger( mixed $number ): ?int {
		return is_int( $number ) && $number > 0 ? $number : null;
	}

	private static function text( mixed $value, int $max_length ): ?string {
		if ( ! is_string( $value ) ) {
			return null;
		}
		$value = trim( $value );
		if ( '' === $value ) {
			return null;
		}
		// Unicode code points, not bytes. WordPress does not require mbstring.
		$characters = preg_split( '//u', $value, $max_length + 1, PREG_SPLIT_NO_EMPTY );
		if ( false === $characters ) {
			return null;
		}
		return implode( '', array_slice( $characters, 0, $max_length ) );
	}
}
