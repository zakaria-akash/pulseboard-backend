// Implemented in Phase 13 — idempotent POST, missing key rejection tests
describe('Usage events — idempotency', () => {
  it.todo('same Idempotency-Key sent twice returns 200 with same payload');
  it.todo('missing Idempotency-Key header returns 400');
});
