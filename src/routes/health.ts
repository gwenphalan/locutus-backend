import type { FastifyPluginAsync } from "fastify";

const root: FastifyPluginAsync = (fastify) => {
    fastify.get("/health", function () {
        return { status: "ok" };
    });
    return Promise.resolve();
};

export default root;
