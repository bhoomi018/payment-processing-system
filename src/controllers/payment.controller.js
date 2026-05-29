const paymentService = require('../services/payment.service');
const { getAllPayments } = require('../models/payment.model');
const logger = require('../utils/logger');

async function initiatePayment(req, res) {
  try {
    const idempotencyKey = req.headers['idempotency-key'] || null;
    const { payment, duplicate } = await paymentService.initiatePayment(req.body, idempotencyKey);
    const statusCode = duplicate ? 200 : 202;
    return res.status(statusCode).json({
      success: true,
      message: duplicate ? 'Duplicate request — returning existing payment' : 'Payment initiated and queued for processing',
      duplicate,
      data: payment.toJSON(),
    });
  } catch (err) {
    logger.error('Failed to initiate payment', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to initiate payment' });
  }
}

async function getPaymentStatus(req, res) {
  try {
    const payment = paymentService.getStatus(req.params.id);
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }
    return res.status(200).json({ success: true, data: payment.toJSON() });
  } catch (err) {
    logger.error('Failed to fetch payment status', { error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to fetch payment status' });
  }
}

async function listPayments(req, res) {
  try {
    const payments = getAllPayments();
    return res.status(200).json({ success: true, count: payments.length, data: payments });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to list payments' });
  }
}

async function handleWebhook(req, res) {
  try {
    const result = await paymentService.handleWebhook(req.params.id, req.body);
    if (!result.accepted) {
      return res.status(200).json({ success: false, message: result.reason });
    }
    return res.status(200).json({ success: true, message: 'Webhook accepted', data: result.payment.toJSON() });
  } catch (err) {
    logger.error('Webhook handling failed', { error: err.message });
    return res.status(500).json({ success: false, error: 'Webhook processing failed' });
  }
}

async function getHealth(req, res) {
  return res.status(200).json({
    success: true,
    status: 'ok',
    system: paymentService.getSystemHealth(),
  });
}

module.exports = { initiatePayment, getPaymentStatus, listPayments, handleWebhook, getHealth };