import { getEncoding, type Tiktoken } from "js-tiktoken";
import { makeChildLogger } from "../../lib/logger.js";
import type {
    ModelProvider,
    GenerateTextRequest,
    GenerateTextResponse,
    StreamTextResult,
} from "./ModelProvider.js";
import type { Logger } from "winston";

import type { ModelRoutingSnapshot } from "./ModelRoutingTypes.js";

/**
 * Configuration for the router's tolerance and behavior.
 */
type RouterConfig = {
    /** Maximum time (ms) to wait for a provider's rate limit to reset. Requests exceeding this are dropped. */
    maxQueueWaitMs: number;
    /** Random delay (ms) added to wait times to prevent thundering herd. */
    jitterMs: number;
    /** Optional provider ID to prioritize when multiple candidates are valid. */
    preferredProviderId?: string;
};

/**
 * The result of the routing decision process.
 */
type RoutingResult = {
    /** The selected provider candidate. */
    selectedCandidate: ModelRoutingSnapshot;
    /** Action to take: execute immediately or wait. */
    action: "EXECUTE_NOW" | "WAIT_THEN_EXECUTE";
    /** Time in milliseconds to wait before execution. */
    waitMs: number;
};

/**
 * Orchestrates model requests by routing them to the optimal provider.
 * Handles rate limiting, cost optimization, and load balancing across registered providers.
 */
export class ProviderRouter {
    protected readonly _logger: Logger;
    private readonly _tokenizer: Tiktoken;

    private _providers: { [key: string]: ModelProvider } = {};
    constructor() {
        this._logger = makeChildLogger("ProviderRouter");
        this._tokenizer = getEncoding("cl100k_base");
        this._logger.info("ProviderRouter initialized");
    }

    /**
     * Calculates the required wait time for a provider based on its rate limits and usage.
     *
     * @param candidate - The provider snapshot to validate.
     * @returns The number of milliseconds to wait (0 if ready immediately).
     */
    validateProvider(candidate: ModelRoutingSnapshot): number {
        const now = new Date();
        let waitMs = 0;
        const minLimit = candidate.minLimit ?? 0;
        const minUsage = candidate.minUsage ?? 0;
        const hourLimit = candidate.hourLimit ?? 0;
        const hourUsage = candidate.hourUsage ?? 0;
        const dayLimit = candidate.dayLimit ?? 0;
        const dayUsage = candidate.dayUsage ?? 0;

        // --- A. Check Minute Limit (Fixed Window) ---
        if (minLimit > 0 && minUsage >= minLimit) {
            const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
            waitMs = Math.max(waitMs, msUntilNextMinute);
        }

        // --- B. Check Hour Limit (Fixed Window) ---
        if (hourLimit > 0 && hourUsage >= hourLimit) {
            const currentSecondsIntoHour = now.getMinutes() * 60 + now.getSeconds();
            const msUntilNextHour = (3600 - currentSecondsIntoHour) * 1000 - now.getMilliseconds();
            waitMs = Math.max(waitMs, msUntilNextHour);
        }

        // --- C. Check Day Limit ---
        if (dayLimit > 0 && dayUsage >= dayLimit) {
            if (!candidate.dayReset) {
                waitMs = Infinity; // Blocked indefinitely
            } else {
                const msUntilDayReset = candidate.dayReset.getTime() - now.getTime();
                waitMs = Math.max(waitMs, msUntilDayReset);
            }
        }

        return waitMs;
    }

    /**
     * Determines the best provider for a request based on current state and config.
     *
     * @remarks
     * The decision process involves:
     * 1. Scoring candidates based on wait times (rate limits).
     * 2. Filtering out candidates exceeding the maximum queue wait time.
     * 3. Ranking valid candidates by preference, tier (free/paid), cost, and immediacy.
     * 4. Selecting the winner and applying jitter to the wait time.
     *
     * @param candidates - List of provider snapshots to evaluate.
     * @param config - Router configuration for tolerance and preferences.
     * @returns The routing decision result, or null if no valid candidates exist.
     */
    decideBestRoute(
        candidates: ModelRoutingSnapshot[],
        config: RouterConfig,
    ): RoutingResult | null {
        // STEP 1: Calculate "Wait Time" for every candidate
        const scoredCandidates = candidates.map((c) => {
            const waitMs = this.validateProvider(c);
            return { candidate: c, requiredWait: waitMs };
        });

        this._logger.debug("Scored candidates", {
            count: scoredCandidates.length,
            candidates: scoredCandidates.map((c) => ({
                provider: c.candidate.providerId,
                wait: c.requiredWait,
            })),
        });

        // STEP 2: Filter out "Impossible" candidates
        // Remove anyone whose wait time exceeds our patience budget
        const validCandidates = scoredCandidates.filter(
            (item) => item.requiredWait <= config.maxQueueWaitMs,
        );

        this._logger.debug("Valid candidates after filtering", {
            count: validCandidates.length,
            candidates: validCandidates.map((c) => c.candidate.providerId),
        });

        if (validCandidates.length === 0) return null;

        // STEP 3: Rank/Sort the valid candidates
        validCandidates.sort((a, b) => {
            const cA = a.candidate;
            const cB = b.candidate;

            // Priority 0: Preferred Provider
            if (config.preferredProviderId) {
                const isPreferredA = cA.providerId === config.preferredProviderId;
                const isPreferredB = cB.providerId === config.preferredProviderId;
                if (isPreferredA !== isPreferredB) return isPreferredA ? -1 : 1;
            }

            // Priority 1: Free Tier vs Paid
            const isFreeA = cA.isFree ?? false;
            const isFreeB = cB.isFree ?? false;
            if (isFreeA !== isFreeB) return isFreeA ? -1 : 1;

            // Priority 2: Cost (Lower is better)
            // Use a small epsilon for float comparison stability
            const costA = cA.costEstimate ?? 0;
            const costB = cB.costEstimate ?? 0;
            if (Math.abs(costA - costB) > 0.000001) {
                return costA - costB;
            }

            // Priority 3: Immediacy (Wait Time)
            // If costs are equal, prefer the one that is ready NOW vs in 500ms
            return a.requiredWait - b.requiredWait;
        });

        // STEP 4: Select Winner & Apply Jitter
        const winner = validCandidates[0];
        if (!winner) return null;
        let finalWait = winner.requiredWait;

        // If we have to wait, add random jitter to prevent burst collision at 00s
        if (finalWait > 0) {
            finalWait += Math.floor(Math.random() * config.jitterMs);
        }

        const result: RoutingResult = {
            selectedCandidate: winner.candidate,
            action: finalWait > 0 ? "WAIT_THEN_EXECUTE" : "EXECUTE_NOW",
            waitMs: finalWait,
        };

        this._logger.debug("Decided best route", {
            selected: winner.candidate.providerId,
            action: result.action,
            waitMs: result.waitMs,
        });

        return result;
    }

    /**
     * Estimates the number of tokens in a request using cl100k_base encoding.
     *
     * @param request - The generation request.
     * @returns Estimated token count.
     */
    private _estimateTokenCount(request: GenerateTextRequest): number {
        let content = "";
        if (request.prompt && typeof request.prompt === "string") {
            content += request.prompt;
        }
        if (request.messages) {
            for (const m of request.messages) {
                if (typeof m.content === "string") {
                    content += m.content;
                } else if (Array.isArray(m.content)) {
                    for (const part of m.content) {
                        if (part.type === "text") {
                            content += part.text;
                        }
                    }
                }
            }
        }
        return this._tokenizer.encode(content).length;
    }

    /**
     * Common logic to resolve the best provider for a request.
     * Handles snapshot gathering, filtering, decision making, waiting, and re-validation.
     */
    private async _resolveRoute(
        request: GenerateTextRequest,
        config: RouterConfig,
        methodName: string,
    ): Promise<ModelProvider> {
        this._logger.info(`Router.${methodName} called`, { modelId: request.modelId });

        const estimatedInputTokens = this._estimateTokenCount(request);
        // Use maxTokens if available, otherwise default to 200 (a reasonable average for chat)
        const estimatedOutputTokens = request.maxTokens ?? 200;

        // Gather snapshots from all providers
        const snapshotPromises = Object.values(this._providers).map(async (provider) => {
            try {
                return await provider.getRoutingSnapshot(
                    request.modelId,
                    estimatedInputTokens,
                    estimatedOutputTokens,
                );
            } catch (error) {
                this._logger.warn(`Failed to get snapshot from ${provider.providerId}`, {
                    error,
                    modelId: request.modelId,
                });
                return null;
            }
        });

        const results = await Promise.all(snapshotPromises);
        const candidates = results.filter((s): s is ModelRoutingSnapshot => s !== null);

        if (candidates.length === 0) {
            throw new Error(`No providers available for model ${request.modelId}`);
        }

        let route: RoutingResult | null = null;

        if (candidates.length === 1 && candidates[0]) {
            const candidate = candidates[0];
            const waitMs = this.validateProvider(candidate);

            if (waitMs <= config.maxQueueWaitMs) {
                let finalWait = waitMs;
                if (finalWait > 0) {
                    finalWait += Math.floor(Math.random() * config.jitterMs);
                }
                route = {
                    selectedCandidate: candidate,
                    action: finalWait > 0 ? "WAIT_THEN_EXECUTE" : "EXECUTE_NOW",
                    waitMs: finalWait,
                };
                this._logger.debug("Single provider optimization used", {
                    providerId: candidate.providerId,
                    waitMs: finalWait,
                });
            }
        } else {
            route = this.decideBestRoute(candidates, config);
        }

        if (!route) {
            throw new Error(`No valid route found for model ${request.modelId} within constraints`);
        }

        if (route.action === "WAIT_THEN_EXECUTE" && route.waitMs > 0) {
            this._logger.info("Router selected provider (wait)", {
                providerId: route.selectedCandidate.providerId,
                action: route.action,
                waitMs: route.waitMs,
            });
            this._logger.info(
                `Waiting ${route.waitMs}ms before executing ${methodName} on ${route.selectedCandidate.providerId}`,
            );
            await new Promise((resolve) => setTimeout(resolve, route.waitMs));

            // Re-validate to prevent race condition
            const freshSnapshot = await this._providers[
                route.selectedCandidate.providerId
            ]?.getRoutingSnapshot(request.modelId, estimatedInputTokens, estimatedOutputTokens);
            if (freshSnapshot && this.validateProvider(freshSnapshot) > 0) {
                throw new Error(
                    `Provider ${route.selectedCandidate.providerId} became unavailable after wait`,
                );
            }
        } else {
            this._logger.info("Router selected provider (immediate)", {
                providerId: route.selectedCandidate.providerId,
                action: route.action,
            });
        }

        const selectedProvider = this._providers[route.selectedCandidate.providerId];
        if (!selectedProvider) {
            throw new Error(`Selected provider ${route.selectedCandidate.providerId} not found`);
        }

        // Record request usage here to prevent race condition
        // The provider's generate/stream methods no longer record usage automatically
        await selectedProvider.recordRequest(request.modelId);

        return selectedProvider;
    }

    /**
     * Generates text using the best available provider.
     * Gathers snapshots from all providers, decides the best route, and executes the request.
     *
     * @param request - The generation request parameters.
     * @param config - Router configuration.
     * @returns The generated text response.
     * @throws {Error} If no providers are available or no valid route is found.
     */
    async generate(
        request: GenerateTextRequest,
        config: RouterConfig,
    ): Promise<GenerateTextResponse> {
        const provider = await this._resolveRoute(request, config, "generate");
        return provider.generateText(request);
    }

    /**
     * Streams text using the best available provider.
     * Gathers snapshots from all providers, decides the best route, and executes the stream.
     *
     * @param request - The generation request parameters.
     * @param config - Router configuration.
     * @returns The streaming result.
     * @throws {Error} If no providers are available or no valid route is found.
     */
    async stream(request: GenerateTextRequest, config: RouterConfig): Promise<StreamTextResult> {
        const provider = await this._resolveRoute(request, config, "stream");
        return provider.streamText(request);
    }

    get providers() {
        return this._providers;
    }

    /**
     * Registers a new model provider with the router.
     *
     * @param provider - The provider instance to register.
     */
    registerProvider<T extends ModelProvider>(provider: T) {
        this._providers[provider.providerId] = provider;
    }
}
