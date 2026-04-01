// Shared in-memory confirmed payments store
// Replace with a database in production

// TTL-based Map to prevent unbounded memory growth
const PAYMENT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_ENTRIES = 500;

type PaymentEntry = { paidAt: string; bookingRef: string; _createdAt: number };

class TTLMap extends Map<string, PaymentEntry> {
  set(key: string, value: Omit<PaymentEntry, '_createdAt'> & { _createdAt?: number }): this {
    // Evict expired entries periodically
    if (this.size > MAX_ENTRIES) this.cleanup();
    return super.set(key, { ...value, _createdAt: value._createdAt ?? Date.now() });
  }

  get(key: string): PaymentEntry | undefined {
    const entry = super.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry._createdAt > PAYMENT_TTL_MS) {
      this.delete(key);
      return undefined;
    }
    return entry;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.entries()) {
      if (now - value._createdAt > PAYMENT_TTL_MS) this.delete(key);
    }
  }
}

export const confirmedPayments = new TTLMap();
