/**
 * src/core/assetCache.ts
 *
 * Shared cross-PDF asset cache for fonts and images.
 * Features bounded LRU eviction and in-flight request coalescing so concurrent
 * requests for identical URLs or font definitions trigger only one fetch.
 */

import { LruCache } from './lruCache.js';

export interface AssetCacheOptions {
  maxImages?: number;
  maxFonts?: number;
}

export class AssetCache {
  private readonly imageCache: LruCache<string, Buffer>;
  private readonly fontCache: LruCache<string, Buffer>;
  private readonly inFlightImages = new Map<string, Promise<Buffer>>();
  private readonly inFlightFonts = new Map<string, Promise<Buffer>>();

  constructor(options: AssetCacheOptions = {}) {
    const maxImages = options.maxImages ?? 128;
    const maxFonts = options.maxFonts ?? 64;
    this.imageCache = new LruCache<string, Buffer>(maxImages);
    this.fontCache = new LruCache<string, Buffer>(maxFonts);
  }

  /**
   * Builds a normalized cache key for font definitions including styling parameters.
   */
  static buildFontKey(url: string, bold?: boolean, italic?: boolean): string {
    return `${url}|b:${bold ? 1 : 0}|i:${italic ? 1 : 0}`;
  }

  /**
   * Retrieves an image from the cache or executes loader with in-flight coalescing.
   */
  async getImage(key: string, loader: () => Promise<Buffer>): Promise<Buffer> {
    const cached = this.imageCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const pending = this.inFlightImages.get(key);
    if (pending !== undefined) {
      return pending;
    }

    const promise = loader()
      .then((buffer) => {
        this.imageCache.set(key, buffer);
        this.inFlightImages.delete(key);
        return buffer;
      })
      .catch((err) => {
        this.inFlightImages.delete(key);
        throw err;
      });

    this.inFlightImages.set(key, promise);
    return promise;
  }

  /**
   * Retrieves a font buffer from the cache or executes loader with in-flight coalescing.
   */
  async getFont(key: string, loader: () => Promise<Buffer>): Promise<Buffer> {
    const cached = this.fontCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const pending = this.inFlightFonts.get(key);
    if (pending !== undefined) {
      return pending;
    }

    const promise = loader()
      .then((buffer) => {
        this.fontCache.set(key, buffer);
        this.inFlightFonts.delete(key);
        return buffer;
      })
      .catch((err) => {
        this.inFlightFonts.delete(key);
        throw err;
      });

    this.inFlightFonts.set(key, promise);
    return promise;
  }

  hasImage(key: string): boolean {
    return this.imageCache.has(key);
  }

  hasFont(key: string): boolean {
    return this.fontCache.has(key);
  }

  get imageCount(): number {
    return this.imageCache.size;
  }

  get fontCount(): number {
    return this.fontCache.size;
  }

  get inFlightImageCount(): number {
    return this.inFlightImages.size;
  }

  get inFlightFontCount(): number {
    return this.inFlightFonts.size;
  }

  clearImages(): void {
    this.imageCache.clear();
    this.inFlightImages.clear();
  }

  clearFonts(): void {
    this.fontCache.clear();
    this.inFlightFonts.clear();
  }

  clear(): void {
    this.clearImages();
    this.clearFonts();
  }
}

/** Default global cross-PDF asset cache */
export const defaultAssetCache: AssetCache = new AssetCache();
