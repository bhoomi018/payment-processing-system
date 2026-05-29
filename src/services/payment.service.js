const config = require('../config');
const logger = require('../utils/logger');
const circuitBreaker = require('../utils/circuitBreaker');
const gateway = require('./gateway.simulator');
const {
  PaymentStatus,
  createPayment,
  getPayment,
  saveIdempotencyResult,
  getIdempotencyResult,
} = require('../models/payment.model');

const processingLocks = new Set();

class PaymentService {
  async initiatePayment(data, idempotencyKey) {
    if (idempotencyKey) {
      const existing = getIdempotencyResult(idempotencyKey);
      if (existing) {
        const payment = getPayment(existing.paymentId);
        logger.info('Idempotent request — returning existing payment', {
          idempotencyKey,
          paymentId: existing.paymentId,
        });
        return { payment, duplicate: true };
      }
    }

    const payment = createPayment(data);
    logger.info('Payment created', { paymentId: payment.id, amount: payment.amount, currency: payment.currency });

    if (idempotencyKey) {
      saveIdempotencyResult(idempotencyKey, payment.id);
    }

    this._processPayment(payment).catch((err) => {
      logger.error('Unhandled error in payment processing', { paymentId: payment.id, error: err.message });
    });

    return { payment, duplicate: false };
  }

  async _processPayment(payment) {
    if (processingLocks.has(payment.id)) {
      logger.warn('Payment already being processed — skipping duplicate trigger', { paymentId: payment.id });
      return;
    }

    processingLocks.add(payment.id);

    try {
      payment.transitionTo(PaymentStatus.PROCESSING, 'Processing started');
      logger.info('Payment processing started', { paymentId: payment.id });
      await this._retryWithBackoff(payment);
    } finally {
      processingLocks.delete(payment.id);
    }
  }

  async _retryWithBackoff(payment) {
    const { maxAttempts, baseDelayMs, maxDelayMs } = config.retry;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      logger.info(`Gateway attempt ${attempt}/${maxAttempts}`, { paymentId: payment.id });

      try {
        const result = await this._callGatewayWithTimeout(payment);

        if (result.success) {
          payment.gatewayReference = result.gatewayReference;
          payment.transitionTo(PaymentStatus.SUCCESS, `Authorized on attempt ${attempt}`);
          logger.info('Payment succeeded', {
            paymentId: payment.id,
            gatewayReference: result.gatewayReference,
            attempt,
          });
          return;
        }

        if (this._isHardFailure(result.message)) {
          payment.failureReason = result.message;
          payment.transitionTo(PaymentStatus.FAILED, `Hard failure: ${result.message}`);
          logger.warn('Payment failed — hard failure, not retrying', {
            paymentId: payment.id,
            reason: result.message,
          });
          return;
        }

        payment.retryCount = attempt;
        logger.warn(`Soft failure on attempt ${attempt}`, { paymentId: payment.id, reason: result.message });

      } catch (err) {
        payment.retryCount = attempt;
        logger.error(`Attempt ${attempt} threw an error`, { paymentId: payment.id, error: err.message });

        if (err.message.includes('Circuit breaker')) {
          payment.failureReason = 'Gateway unavailable — circuit breaker open';
          payment.transitionTo(PaymentStatus.FAILED, payment.failureReason);
          return;
        }
      }

      if (attempt < maxAttempts) {
        payment.transitionTo(PaymentStatus.PENDING, `Waiting before attempt ${attempt + 1}`);
        const delay = this._calcBackoff(attempt, baseDelayMs, maxDelayMs);
        logger.info(`Waiting ${delay}ms before next attempt`, { paymentId: payment.id });
        await this._sleep(delay);
        payment.transitionTo(PaymentStatus.PROCESSING, `Retrying — attempt ${attempt + 1}`);
      }
    }

    payment.failureReason = payment.failureReason || 'All retry attempts exhausted';
    payment.transitionTo(PaymentStatus.FAILED, payment.failureReason);
    logger.error('Payment failed after all attempts', {
      paymentId: payment.id,
      retryCount: payment.retryCount,
    });
  }

  async _callGatewayWithTimeout(payment) {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gateway timeout')), config.gateway.timeoutMs)
    );
    return circuitBreaker.call(() =>
      Promise.race([gateway.charge(payment), timeoutPromise])
    );
  }

  _isHardFailure(message = '') {
    const hardFailures = [
      'Insufficient funds',
      'Invalid card details',
      'Transaction limit exceeded',
    ];
    return hardFailures.some((f) => message.includes(f));
  }

  _calcBackoff(attempt, base, max) {
    const exponential = base * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 200;
    return Math.min(exponential + jitter, max);
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async handleWebhook(paymentId, webhookData) {
    const payment = getPayment(paymentId);
    if (!payment) {
      logger.warn('Webhook received for unknown payment', { paymentId });
      return { accepted: false, reason: 'Payment not found' };
    }

    if (payment.webhookReceivedAt) {
      logger.info('Duplicate webhook ignored', { paymentId });
      return { accepted: false, reason: 'Webhook already processed' };
    }

    if (
      payment.status === PaymentStatus.SUCCESS &&
      webhookData.status !== PaymentStatus.SUCCESS
    ) {
      logger.warn('Conflicting webhook ignored — payment already succeeded', { paymentId });
      return { accepted: false, reason: 'Conflicting state — payment already succeeded' };
    }

    payment.webhookReceivedAt = new Date().toISOString();

    if (
      webhookData.status === PaymentStatus.SUCCESS &&
      payment.status !== PaymentStatus.SUCCESS
    ) {
      try {
        payment.transitionTo(PaymentStatus.SUCCESS, 'Updated via webhook');
        if (webhookData.gatewayReference) {
          payment.gatewayReference = webhookData.gatewayReference;
        }
        logger.info('Payment status updated via webhook', { paymentId, newStatus: PaymentStatus.SUCCESS });
      } catch (err) {
        logger.error('Webhook state transition failed', { paymentId, error: err.message });
        return { accepted: false, reason: err.message };
      }
    }

    return { accepted: true, payment };
  }

  getStatus(paymentId) {
    return getPayment(paymentId);
  }

  getSystemHealth() {
    return {
      circuitBreaker: circuitBreaker.getStatus(),
      activeProcessing: processingLocks.size,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = new PaymentService();