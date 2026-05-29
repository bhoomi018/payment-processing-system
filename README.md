# Payment Processing System

A Node.js-based payment processing system that simulates real-world payment workflows with reliability and fault tolerance.

## Features

* Payment lifecycle management
* Retry mechanism with exponential backoff
* Idempotency support
* Concurrency control
* Circuit breaker pattern
* Webhook handling
* Rate limiting
* Structured logging
* Test coverage for core flows

## Installation

```bash
npm install
```

## Run

```bash
npm start
```

## Test

```bash
npm test
```

## API Endpoints

* POST `/api/v1/payments`
* GET `/api/v1/payments/:id`
* GET `/api/v1/payments`
* POST `/api/v1/payments/:id/webhook`
* GET `/api/v1/health`
