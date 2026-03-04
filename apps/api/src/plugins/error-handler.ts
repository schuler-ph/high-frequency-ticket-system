import fp from "fastify-plugin";
import type { FastifyError } from "fastify";
import { AppError } from "@repo/types/errors";

/**
 * This plugin sets up a global error handler for the Fastify application.
 * It provides a consistent JSON structure for all errors.
 */
export default fp(async (fastify) => {
  fastify.setErrorHandler(function (error: FastifyError, request, reply) {
    // 1. Log the error using Fastify's structured Pino logger.
    // The logger automatically includes the request ID.
    request.log.error(error);

    // 2. Identify the error type
    const isProduction = process.env.NODE_ENV === "production";
    const reqId = request.id;

    if (error instanceof AppError) {
      // It's a known operational error from our domain
      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.name,
        message: error.message,
        reqId,
      });
    }

    if (error.validation) {
      // It's a Fastify / Zod validation error
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: error.message,
        reqId,
      });
    }

    // 3. Unhandled/Unknown Errors (500)
    // In production, we NEVER leak the real error message to the client.
    const statusCode = error.statusCode || 500;
    const message =
      isProduction && statusCode >= 500
        ? "An unexpected error occurred"
        : error.message || "An unexpected error occurred";

    reply.status(statusCode).send({
      statusCode,
      error: statusCode >= 500 ? "Internal Server Error" : error.name,
      message,
      reqId,
    });
  });
});
