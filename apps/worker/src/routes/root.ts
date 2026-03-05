import { FastifyPluginAsync } from "fastify";

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async signature
const root: FastifyPluginAsync = async (fastify, _opts): Promise<void> => {
  fastify.get("/", function (_request, _reply) {
    return { root: true };
  });
};

export default root;
