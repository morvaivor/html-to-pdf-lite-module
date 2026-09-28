/**
 * src/core/lruCache.ts
 *
 * Generic, high-performance Least-Recently-Used (LRU) Cache.
 * A Map indexes intrusive doubly-linked nodes ordered from least to most recently used:
 * a hit is one Map lookup plus pointer relinking (no Map delete/re-insert, which leaves holes that
 * force V8 to periodically rehash the backing table), and eviction recycles the evicted node, so a
 * full cache performs no allocation per insertion.
 */

interface LruNode<K, V> {
  key: K;
  value: V;
  prev: LruNode<K, V> | null;
  next: LruNode<K, V> | null;
}

export class LruCache<K, V> {
  private readonly items: Map<K, LruNode<K, V>>;
  /** Least recently used node. */
  private head: LruNode<K, V> | null = null;
  /** Most recently used node. */
  private tail: LruNode<K, V> | null = null;
  readonly maxSize: number;

  constructor(maxSize: number) {
    if (maxSize <= 0) {
      throw new Error(`LruCache maxSize must be greater than 0, got ${maxSize}`);
    }
    this.maxSize = maxSize;
    this.items = new Map<K, LruNode<K, V>>();
  }

  /**
   * Retrieves an item by key and marks it as most recently used.
   */
  get(key: K): V | undefined {
    const node = this.items.get(key);
    if (node === undefined || node.value === undefined) {
      return undefined;
    }
    if (node !== this.tail) {
      this.unlink(node);
      this.append(node);
    }
    return node.value;
  }

  /**
   * Adds or updates an item and marks it as most recently used.
   * Evicts the least-recently used entry if size exceeds maxSize.
   */
  set(key: K, value: V): void {
    let node = this.items.get(key);
    if (node !== undefined) {
      node.value = value;
      if (node !== this.tail) {
        this.unlink(node);
        this.append(node);
      }
      return;
    }
    if (this.items.size >= this.maxSize && this.head !== null) {
      // Recycle the least-recently used node for the new entry.
      node = this.head;
      this.unlink(node);
      this.items.delete(node.key);
      node.key = key;
      node.value = value;
    } else {
      node = { key, value, prev: null, next: null };
    }
    this.append(node);
    this.items.set(key, node);
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
    const node = this.items.get(key);
    if (node === undefined) return false;
    this.unlink(node);
    return this.items.delete(key);
  }

  /**
   * Clears all entries from the cache.
   */
  clear(): void {
    this.items.clear();
    this.head = null;
    this.tail = null;
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
  *keys(): IterableIterator<K> {
    for (let node = this.head; node !== null; node = node.next) yield node.key;
  }

  /**
   * Returns an iterator of values in least-to-most recently used order.
   */
  *values(): IterableIterator<V> {
    for (let node = this.head; node !== null; node = node.next) yield node.value;
  }

  /**
   * Returns an iterator of [key, value] pairs in least-to-most recently used order.
   */
  *entries(): IterableIterator<[K, V]> {
    for (let node = this.head; node !== null; node = node.next) yield [node.key, node.value];
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  private unlink(node: LruNode<K, V>): void {
    if (node.prev !== null) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next !== null) node.next.prev = node.prev;
    else this.tail = node.prev;
    node.prev = null;
    node.next = null;
  }

  private append(node: LruNode<K, V>): void {
    node.prev = this.tail;
    node.next = null;
    if (this.tail !== null) this.tail.next = node;
    else this.head = node;
    this.tail = node;
  }
}
