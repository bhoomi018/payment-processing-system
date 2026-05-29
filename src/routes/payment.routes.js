const express = require('express');
const router = express.Router();
const controller = require('../controllers/payment.controller');
const { validateInitiatePayment, validateWebhook } = require('../middleware/validation');

router.post('/payments', validateInitiatePayment, controller.initiatePayment);
router.get('/payments', controller.listPayments);
router.get('/payments/:id', controller.getPaymentStatus);
router.post('/payments/:id/webhook', validateWebhook, controller.handleWebhook);
router.get('/health', controller.getHealth);

module.exports = router;