const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger');

class GatewaySimulator {
  constructor() {
    this.successRate = config.gateway.successRate;
    this.timeoutMs = config.gateway.timeoutMs;
  }

  async charge(payment) {
    const scenario = this._pickScenario();
    logger.info(`Gateway scenario selected`, { paymentId: payment.id, scenario });

    switch (scenario) {
      case 'success':      return this._simulateSuccess(payment);
      case 'failure':      return this._simulateFailure(payment);
      case 'timeout':      return this._simulateTimeout(payment);
      case 'slow_success': return this._simulateSlowSuccess(payment);
      default:             return this._simulateSuccess(payment);
    }
  }

  _pickScenario() {
    const roll = Math.random();
    if (roll < 0.60) return 'success';
    if (roll < 0.75) return 'failure';
    if (roll < 0.88) return 'slow_success';
    return 'timeout';
  }

  async _simulateSuccess(payment) {
    await this._delay(200, 600);
    return {
      success: true,
      gatewayReference: `GW-${uuidv4().split('-')[0].toUpperCase()}`,
      message: 'Payment authorized',
    };
  }

  async _simulateFailure(payment) {
    await this._delay(100, 400);
    const reasons = [
      'Insufficient funds',
      'Card declined by issuer',
      'Invalid card details',
      'Transaction limit exceeded',
    ];
    return {
      success: false,
      gatewayReference: null,
      message: reasons[Math.floor(Math.random() * reasons.length)],
    };
  }

  async _simulateSlowSuccess(payment) {
    await this._delay(2000, 4000);
    return {
      success: true,
      gatewayReference: `GW-${uuidv4().split('-')[0].toUpperCase()}`,
      message: 'Payment authorized (delayed)',
    };
  }

  async _simulateTimeout(payment) {
    await this._delay(this.timeoutMs + 1000, this.timeoutMs + 3000);
    return { success: false, message: 'Gateway timeout' };
  }

  _delay(min, max) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new GatewaySimulator();