const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const logger = require('./utils/logger');
const paymentRoutes = require('./routes/payment.routes');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests — please slow down' },
});
app.use('/api', limiter);

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    idempotencyKey: req.headers['idempotency-key'] || null,
  });
  next();
});

app.use('/api/v1', paymentRoutes);

app.get('/', (req, res) => {
  res.json({
    name: 'Payment Processing System',
    version: '1.0.0',
    docs: '/api/v1/health',
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

app.use((err, req, res, next) => {
  logger.error('Unhandled server error', { error: err.message, stack: err.stack });
  res.status(500).json({ success: false, error: 'Internal server error' });
});

module.exports = app;

if (require.main === module) {
  app.listen(config.port, () => {
    logger.info(`Payment service running on port ${config.port} [${config.env}]`);
  });
}