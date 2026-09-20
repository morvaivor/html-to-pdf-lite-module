/**
 * src/core/lruCache.ts
 *
 * Generic, high-performance Least-Recently-Used (LRU) Cache backed by ES Map.
 * Provides O(1) get, set, has, and delete with automatic eviction of the
 * least-recently-accessed entry when maxSize is exceeded.
 */

export class LruCache<K, V> {
  private readonly items: Map<K, V>;
  readonly maxSize: number;

  constructor(maxSize: number) {
    if (maxSize <= 0) {
      throw new Error(`LruCache maxSize must be greater than 0, got ${maxSize}`);
    }
    this.maxSize = maxSize;
    this.items = new Map<K, V>();
  }

  /**
   * Retrieves an item by key and marks it as most recently used.
   */
  get(key: K): V | undefined {
    const value = this.items.get(key);
    if (value === undefined) {
      return undefined;
    }
    // Refresh recency: remove and re-insert at tail
    this.items.delete(key);
    this.items.set(key, value);
    return value;
  }

  /**
   * Adds or updates an item and marks it as most recently used.
   * Evicts the least-recently used entry if size exceeds maxSize.
   */
  set(key: K, value: V): void {
    if (this.items.has(key)) {
      this.items.delete(key);
    } else if (this.items.size >= this.maxSize) {
      // Evict least-recently used item (first item in Map)
      const oldestKey = this.items.keys().next().value;
      if (oldestKey !== undefined) {
        this.items.delete(oldestKey);
      }
    }
    this.items.set(key, value);
  }

  /**
   * Returns true if key exists in cache without altering its recency.
   */
  has(key: K): boolean {
    return this.items.has(key);
  }

  /**
   * Deletes an item from the cache. Returns true if removed, false otherwise.
   */
  delete(key: K): boolean {
    return this.items.delete(key);
  }

  /**
   * Clears all entries from the cache.
   */
  clear(): void {
    this.items.clear();
  }

  /**
   * Current number of entries in the cache.
   */
  get size(): number {
    return this.items.size;
  }

  /**
   * Returns an iterator of keys in least-to-most recently used order.
   */
  keys(): IterableIterator<K> {
    return this.items.keys();
  }

  /**
   * Returns an iterator of values in least-to-most recently used order.
   */
  values(): IterableIterator<V> {
    return this.items.values();
  }

  /**
   * Returns an iterator of [key, value] pairs.
   */
  entries(): IterableIterator<[K, V]> {
    return this.items.entries();
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.items.entries();
  }
}
