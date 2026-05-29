require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT) || 3000,
  env: process.env.NODE_ENV || 'development',

  retry: {
    maxAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS) || 3,
    baseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS) || 1000,
    maxDelayMs: parseInt(process.env.RETRY_MAX_DELAY_MS) || 10000,
  },

  gateway: {
    timeoutMs: parseInt(process.env.GATEWAY_TIMEOUT_MS) || 5000,
    successRate: parseFloat(process.env.GATEWAY_SUCCESS_RATE) || 0.7,
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  },

  circuitBreaker: {
    threshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD) || 5,
    timeoutMs: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT_MS) || 30000,
  },
};

module.exports = config;