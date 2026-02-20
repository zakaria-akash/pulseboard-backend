// Implemented in Phase 13 — CRUD, tenant isolation, validation, pagination tests
describe('Check routes', () => {
  it.todo('GET /checks returns paginated list for authenticated tenant');
  it.todo('POST /checks creates a check and returns 201');
  it.todo('Cross-tenant access returns 404');
  it.todo('POST /checks with missing url returns 400 with Zod details');
});
