import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type AppInstance } from "./app.js";

describe("buildApp", () => {
    const apps: AppInstance[] = [];

    afterEach(async () => {
        while (apps.length > 0) {
            const app = apps.pop();
            if (app) {
                await app.close();
            }
        }
    });

    it("builds the Fastify app without listening on a port", async () => {
        const app = await buildApp();
        apps.push(app);

        expect(app.server.listening).toBe(false);
    });

    it("supports request injection for the health route", async () => {
        const app = await buildApp();
        apps.push(app);

        const response = await app.inject({
            method: "GET",
            url: "/health",
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ status: "ok" });
    });
});
