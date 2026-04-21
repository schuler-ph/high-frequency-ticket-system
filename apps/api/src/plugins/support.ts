import fp from "fastify-plugin";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SupportPluginOptions {}

export const supportPlugin = fp<SupportPluginOptions>(
  (fastify, _opts, done) => {
    fastify.decorate("someSupport", function () {
      return "hugs";
    });
    done();
  },
);

// The use of fastify-plugin is required to be able
// to export the decorators to the outer scope
export default supportPlugin;

// When using .decorate you have to specify added properties for Typescript
declare module "fastify" {
  export interface FastifyInstance {
    someSupport(): string;
  }
}
