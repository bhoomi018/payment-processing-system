const { v4: uuidv4 } = require('uuid');

const PaymentStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  FAILED: 'failed',
};

const VALID_TRANSITIONS = {
  [PaymentStatus.PENDING]: [PaymentStatus.PROCESSING],
  [PaymentStatus.PROCESSING]: [PaymentStatus.SUCCESS, PaymentStatus.FAILED, PaymentStatus.PENDING],
  [PaymentStatus.SUCCESS]: [],
  [PaymentStatus.FAILED]: [],
};

const paymentStore = new Map();
const idempotencyStore = new Map();

class Payment {
  constructor({ amount, currency, customerId, description, metadata = {} }) {
    this.id = uuidv4();
    this.amount = amount;
    this.currency = currency.toUpperCase();
    this.customerId = customerId;
    this.description = description;
    this.metadata = metadata;
    this.status = PaymentStatus.PENDING;
    this.retryCount = 0;
    this.gatewayReference = null;
    this.failureReason = null;
    this.webhookReceivedAt = null;
    this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
    this.statusHistory = [
      { status: PaymentStatus.PENDING, timestamp: this.createdAt, note: 'Payment initiated' },
    ];
  }

  transitionTo(newStatus, note = '') {
    const allowed = VALID_TRANSITIONS[this.status];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new Error(`Invalid state transition: ${this.status} → ${newStatus}`);
    }
    this.status = newStatus;
    this.updatedAt = new Date().toISOString();
    this.statusHistory.push({ status: newStatus, timestamp: this.updatedAt, note });
  }

  toJSON() {
    return {
      id: this.id,
      amount: this.amount,
      currency: this.currency,
      customerId: this.customerId,
      description: this.description,
      status: this.status,
      retryCount: this.retryCount,
      gatewayReference: this.gatewayReference,
      failureReason: this.failureReason,
      metadata: this.metadata,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      statusHistory: this.statusHistory,
    };
  }
}

function createPayment(data) {
  const payment = new Payment(data);
  paymentStore.set(payment.id, payment);
  return payment;
}

function getPayment(id) {
  return paymentStore.get(id) || null;
}

function getAllPayments() {
  return Array.from(paymentStore.values()).map((p) => p.toJSON());
}

function saveIdempotencyResult(key, paymentId) {
  idempotencyStore.set(key, { paymentId, createdAt: Date.now() });
}

function getIdempotencyResult(key) {
  return idempotencyStore.get(key) || null;
}

function pruneIdempotencyStore() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, val] of idempotencyStore.entries()) {
    if (val.createdAt < cutoff) idempotencyStore.delete(key);
  }
}

function _clearStore() {
  paymentStore.clear();
  idempotencyStore.clear();
}

module.exports = {
  Payment,
  PaymentStatus,
  VALID_TRANSITIONS,
  createPayment,
  getPayment,
  getAllPayments,
  saveIdempotencyResult,
  getIdempotencyResult,
  pruneIdempotencyStore,
  _clearStore,
};