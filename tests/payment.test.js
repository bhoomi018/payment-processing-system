const request = require('supertest');
const app = require('../src/app');
const { _clearStore, getPayment, PaymentStatus } = require('../src/models/payment.model');
const circuitBreaker = require('../src/utils/circuitBreaker');
const paymentService = require('../src/services/payment.service');

const validPayload = {
  amount: 1500.00,
  currency: 'INR',
  customerId: 'cust_test_001',
  description: 'Test payment',
};

beforeEach(() => {
  _clearStore();
  circuitBreaker._reset();
});

describe('POST /api/v1/payments — Payment Initiation', () => {
  test('creates a payment and returns 202', async () => {
    const res = await request(app).post('/api/v1/payments').send(validPayload);
    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect([PaymentStatus.PENDING, PaymentStatus.PROCESSING]).toContain(res.body.data.status);
    expect(res.body.data.id).toBeDefined();
  });

  test('rejects missing required fields', async () => {
    const res = await request(app).post('/api/v1/payments').send({ amount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  test('rejects negative amount', async () => {
    const res = await request(app).post('/api/v1/payments').send({ ...validPayload, amount: -50 });
    expect(res.status).toBe(400);
  });

  test('rejects invalid currency code', async () => {
    const res = await request(app).post('/api/v1/payments').send({ ...validPayload, currency: 'INVALID' });
    expect(res.status).toBe(400);
  });
});

describe('Idempotency', () => {
  test('returns same payment for duplicate idempotency key', async () => {
    const key = 'idem-key-001';
    const first = await request(app).post('/api/v1/payments').set('idempotency-key', key).send(validPayload);
    const second = await request(app).post('/api/v1/payments').set('idempotency-key', key).send(validPayload);
    expect(first.body.data.id).toBe(second.body.data.id);
    expect(second.body.duplicate).toBe(true);
    expect(second.status).toBe(200);
  });

  test('creates different payments for different idempotency keys', async () => {
    const first = await request(app).post('/api/v1/payments').set('idempotency-key', 'key-A').send(validPayload);
    const second = await request(app).post('/api/v1/payments').set('idempotency-key', 'key-B').send(validPayload);
    expect(first.body.data.id).not.toBe(second.body.data.id);
  });
});

describe('GET /api/v1/payments/:id', () => {
  test('returns payment status', async () => {
    const createRes = await request(app).post('/api/v1/payments').send(validPayload);
    const id = createRes.body.data.id;
    const statusRes = await request(app).get(`/api/v1/payments/${id}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.id).toBe(id);
  });

  test('returns 404 for unknown payment', async () => {
    const res = await request(app).get('/api/v1/payments/nonexistent-id');
    expect(res.status).toBe(404);
  });
});

describe('Payment State Transitions', () => {
  test('rejects invalid state transition', () => {
    const { Payment, PaymentStatus } = require('../src/models/payment.model');
    const payment = new Payment(validPayload);
    expect(() => payment.transitionTo(PaymentStatus.SUCCESS)).toThrow('Invalid state transition');
  });

  test('records status history on transitions', () => {
    const { Payment, PaymentStatus } = require('../src/models/payment.model');
    const payment = new Payment(validPayload);
    payment.transitionTo(PaymentStatus.PROCESSING, 'test');
    payment.transitionTo(PaymentStatus.SUCCESS, 'done');
    expect(payment.statusHistory).toHaveLength(3);
  });

  test('terminal states cannot be transitioned out of', () => {
    const { Payment, PaymentStatus } = require('../src/models/payment.model');
    const payment = new Payment(validPayload);
    payment.transitionTo(PaymentStatus.PROCESSING);
    payment.transitionTo(PaymentStatus.SUCCESS);
    expect(() => payment.transitionTo(PaymentStatus.FAILED)).toThrow();
  });
});

describe('Retry Logic', () => {
  test('retries on soft failure and eventually resolves', async () => {
    const createRes = await request(app).post('/api/v1/payments').send(validPayload);
    const id = createRes.body.data.id;
    await new Promise((r) => setTimeout(r, 8000));
    const statusRes = await request(app).get(`/api/v1/payments/${id}`);
    const finalStatus = statusRes.body.data.status;
    expect([PaymentStatus.SUCCESS, PaymentStatus.FAILED]).toContain(finalStatus);
  }, 15000);
});

describe('Webhook Handling', () => {
  test('accepts a valid success webhook', async () => {
    const createRes = await request(app).post('/api/v1/payments').send(validPayload);
    const id = createRes.body.data.id;
    await new Promise((r) => setTimeout(r, 200));
    const res = await request(app).post(`/api/v1/payments/${id}/webhook`).send({ status: 'success', gatewayReference: 'GW-WEBHOOK123' });
    expect(res.status).toBe(200);
  });

  test('rejects duplicate webhooks', async () => {
    const createRes = await request(app).post('/api/v1/payments').send(validPayload);
    const id = createRes.body.data.id;
    const payload = { status: 'success', gatewayReference: 'GW-DUP' };
    await request(app).post(`/api/v1/payments/${id}/webhook`).send(payload);
    const second = await request(app).post(`/api/v1/payments/${id}/webhook`).send(payload);
    expect(second.body.success).toBe(false);
    expect(second.body.message).toContain('already processed');
  });

  test('rejects webhook for unknown payment', async () => {
    const res = await request(app).post('/api/v1/payments/unknown-id/webhook').send({ status: 'success' });
    expect(res.body.success).toBe(false);
  });
});

describe('Circuit Breaker', () => {
  test('opens after threshold failures', () => {
    for (let i = 0; i < 5; i++) circuitBreaker._onFailure();
    expect(circuitBreaker.state).toBe('open');
  });

  test('resets on success', () => {
    circuitBreaker._onFailure();
    circuitBreaker._onFailure();
    circuitBreaker._onSuccess();
    expect(circuitBreaker.state).toBe('closed');
    expect(circuitBreaker.failureCount).toBe(0);
  });

  test('blocks requests when open', async () => {
    for (let i = 0; i < 5; i++) circuitBreaker._onFailure();
    circuitBreaker.nextAttemptTime = Date.now() + 60000;
    await expect(circuitBreaker.call(() => Promise.resolve('ok'))).rejects.toThrow('Circuit breaker');
  });
});

describe('Concurrency Control', () => {
  test('does not process the same payment twice concurrently', async () => {
    const createRes = await request(app).post('/api/v1/payments').send(validPayload);
    const payment = getPayment(createRes.body.data.id);
    const logSpy = jest.spyOn(require('../src/utils/logger'), 'warn');
    await Promise.all([
      paymentService._processPayment(payment),
      paymentService._processPayment(payment),
    ]);
    const duplicateWarnings = logSpy.mock.calls.filter(([msg]) => msg.includes('already being processed'));
    expect(duplicateWarnings.length).toBeGreaterThanOrEqual(1);
    logSpy.mockRestore();
  });
});

describe('GET /api/v1/health', () => {
  test('returns system health', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.system.circuitBreaker).toBeDefined();
  });
});