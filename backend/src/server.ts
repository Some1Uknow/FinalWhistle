/**
 * This service was superseded by the same-origin Next.js API in apps/web.
 * It deliberately fails even when invoked directly so an outdated endpoint
 * implementation cannot be exposed by accident.
 */
throw new Error(
  "The legacy Fastify backend is retired and must not be deployed. Use the Next.js API in apps/web instead."
);
