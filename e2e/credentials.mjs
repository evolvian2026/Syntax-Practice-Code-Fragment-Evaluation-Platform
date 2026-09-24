/**
 * Credentials for the end-to-end server, shared by the harness that seeds it
 * and the tests that sign in.
 *
 * The suite runs the server with NODE_ENV=production so it exercises the real
 * production configuration, and production refuses the demo passwords printed
 * in the README. These are throwaway values for a throwaway database.
 */
export const E2E_JWT_SECRET = 'e2e-only-jwt-secret-for-a-throwaway-database-0001';
export const E2E_ADMIN_PASSWORD = 'e2e-admin-pass-9f2c';
export const E2E_STUDENT_PASSWORD = 'e2e-student-pass-4b7d';
