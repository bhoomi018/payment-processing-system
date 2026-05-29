const config = require('../config');
const logger = require('../utils/logger');

const CircuitState = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open',
};

class CircuitBreaker {
  constructor() {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.threshold = config.circuitBreaker.threshold;
    this.timeoutMs = config.circuitBreaker.timeoutMs;
    this.nextAttemptTime = null;
  }

  async call(operation) {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        throw new Error('Circuit breaker is open — gateway requests are blocked');
      }
      this.state = CircuitState.HALF_OPEN;
      logger.info('Circuit breaker moved to HALF_OPEN — probing gateway');
    }

    try {
      const result = await operation();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  _onSuccess() {
    this.failureCount = 0;
    if (this.state !== CircuitState.CLOSED) {
      logger.info('Circuit breaker closed — gateway is healthy again');
    }
    this.state = CircuitState.CLOSED;
  }

  _onFailure() {
    this.failureCount += 1;
    if (this.state === CircuitState.HALF_OPEN || this.failureCount >= this.threshold) {
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.timeoutMs;
      logger.warn('Circuit breaker opened', {
        failureCount: this.failureCount,
        retryAfter: new Date(this.nextAttemptTime).toISOString(),
      });
    }
  }

  getStatus() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      nextAttemptTime: this.nextAttemptTime
        ? new Date(this.nextAttemptTime).toISOString()
        : null,
    };
  }

  _reset() {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.nextAttemptTime = null;
  }
}

module.exports = new CircuitBreaker();