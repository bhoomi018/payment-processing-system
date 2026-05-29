const Joi = require('joi');

const initiatePaymentSchema = Joi.object({
  amount: Joi.number().positive().precision(2).required()
    .messages({ 'number.positive': 'Amount must be a positive number' }),
  currency: Joi.string().length(3).uppercase().required()
    .messages({ 'string.length': 'Currency must be a 3-letter ISO code (e.g. USD, INR)' }),
  customerId: Joi.string().min(1).max(64).required(),
  description: Joi.string().min(1).max(255).required(),
  metadata: Joi.object().optional(),
});

const webhookSchema = Joi.object({
  status: Joi.string().valid('success', 'failed').required(),
  gatewayReference: Joi.string().optional(),
  message: Joi.string().optional(),
});

function validateInitiatePayment(req, res, next) {
  const { error } = initiatePaymentSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: error.details.map((d) => d.message),
    });
  }
  next();
}

function validateWebhook(req, res, next) {
  const { error } = webhookSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      success: false,
      error: 'Invalid webhook payload',
      details: error.details.map((d) => d.message),
    });
  }
  next();
}

module.exports = { validateInitiatePayment, validateWebhook };