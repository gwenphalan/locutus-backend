import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProviderRouter } from "./ProviderRouter";
import type { ModelRoutingSnapshot } from "./ModelRoutingTypes";

describe("ProviderRouter", () => {
    let router: ProviderRouter;

    beforeEach(() => {
        router = new ProviderRouter();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("validateProvider", () => {
        it("should return 0 wait time if no limits are exceeded", () => {
            const snapshot: ModelRoutingSnapshot = {
                providerId: "test-provider",
                id: "test-model",
                minLimit: 10,
                minUsage: 5,
            };
            expect(router.validateProvider(snapshot)).toBe(0);
        });

        it("should calculate wait time for minute limit", () => {
            const now = new Date("2023-01-01T12:00:30Z");
            vi.setSystemTime(now);

            const snapshot: ModelRoutingSnapshot = {
                providerId: "test-provider",
                id: "test-model",
                minLimit: 10,
                minUsage: 10, // Limit reached
            };

            // Should wait until next minute (30s remaining)
            const wait = router.validateProvider(snapshot);
            expect(wait).toBe(30000);
        });
    });

    describe("decideBestRoute", () => {
        const baseSnapshot: ModelRoutingSnapshot = {
            providerId: "p1",
            id: "m1",
        };

        it("should prioritize preferred provider", () => {
            const c1 = { ...baseSnapshot, providerId: "p1", costEstimate: 0.02 };
            const c2 = { ...baseSnapshot, providerId: "p2", costEstimate: 0.01 }; // Cheaper but not preferred

            const result = router.decideBestRoute([c1, c2], {
                maxQueueWaitMs: 1000,
                jitterMs: 0,
                preferredProviderId: "p1",
            });

            expect(result?.selectedCandidate.providerId).toBe("p1");
        });

        it("should prioritize free tier over paid", () => {
            const c1 = { ...baseSnapshot, providerId: "paid", isFree: false };
            const c2 = { ...baseSnapshot, providerId: "free", isFree: true };

            const result = router.decideBestRoute([c1, c2], {
                maxQueueWaitMs: 1000,
                jitterMs: 0,
            });

            expect(result?.selectedCandidate.providerId).toBe("free");
        });

        it("should prioritize lower cost", () => {
            const c1 = { ...baseSnapshot, providerId: "expensive", costEstimate: 0.02 };
            const c2 = { ...baseSnapshot, providerId: "cheap", costEstimate: 0.01 };

            const result = router.decideBestRoute([c1, c2], {
                maxQueueWaitMs: 1000,
                jitterMs: 0,
            });

            expect(result?.selectedCandidate.providerId).toBe("cheap");
        });

        it("should filter out candidates exceeding maxQueueWaitMs", () => {
            const c1 = { ...baseSnapshot, providerId: "slow", minLimit: 1, minUsage: 1 }; // Will have wait time

            // Mock time to ensure wait time is calculated
            vi.setSystemTime(new Date("2023-01-01T12:00:30Z"));
            // Wait is 30s (30000ms)

            const result = router.decideBestRoute([c1], {
                maxQueueWaitMs: 5000, // Only willing to wait 5s
                jitterMs: 0,
            });

            expect(result).toBeNull();
        });
    });
});
