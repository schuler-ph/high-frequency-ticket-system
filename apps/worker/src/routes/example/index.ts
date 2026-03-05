import { FastifyPluginAsync } from "fastify";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async signature
const example: FastifyPluginAsync = async (fastify, _opts): Promise<void> => {
  fastify.get("/", function (_request, _reply) {
    return "this is an example";
  });
};

export default example;
