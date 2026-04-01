// Shared in-memory confirmed payments store
// Replace with a database in production
export const confirmedPayments = new Map<string, { paidAt: string; bookingRef: string }>();
