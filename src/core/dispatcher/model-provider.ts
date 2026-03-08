import { generateText, streamText } from "ai";
import type {
    CallSettings,
    LanguageModelUsage,
    Prompt,
    ProviderMetadata,
    ToolChoice,
    ToolSet,
} from "ai";
import type { Logger } from "winston";
import { makeChildLogger } from "../../lib/logger.js";
import { toProviderError } from "../../lib/errors.js";
import { type ModelQuotaState } from "./model-routing-types.js";
import { getRedisClient } from "../../lib/database.js";
import type {
    ModelPricing,
    ModelRateLimits,
    ModelRoutingSnapshot,
    ModelUsageSnapshot,
    ProviderCredits,
    ParsedModelId,
} from "./model-routing-types.js";

export type ModelMessageRole = "system" | "user" | "assistant" | "tool";

/**
 * Request parameters for generating text.
 * Extends AI SDK's CallSettings and Prompt.
 */
export type GenerateTextRequest = CallSettings &
    Prompt & {
        /** ID of the model to use. */
        modelId: string;
        /** Tool definitions for function calling. */
        tools?: ToolSet;
        /** Tool choice configuration. */
        toolChoice?: ToolChoice<ToolSet>;
        /** Maximum number of tokens to generate. */
        maxTokens?: number;
        /** Additional metadata for logging or provider-specific options. */
        metadata?: Record<string, unknown>;
    };

/**
 * Response from a text generation request.
 */
export interface GenerateTextResponse {
    /** Generated text content. */
    text: string;
    /** Reason why generation finished (e.g., "stop", "length"). */
    finishReason?: string;
    /** Token usage statistics. */
    usage?: LanguageModelUsage;
    /** Provider-specific metadata. */
    providerMetadata?: ProviderMetadata;
}

/**
 * Result of a streaming text generation request.
 * Contains both the stream and promises for final results.
 */
export interface StreamTextResult {
    /** Async iterable of text chunks. */
    textStream: AsyncIterable<string>;
    /** Promise resolving to the full generated text. */
    text: Promise<string>;
    /** Promise resolving to the final usage statistics. */
    usage: Promise<GenerateTextResponse["usage"]>;
}

/**
 * Abstract base class for model providers.
 * Handles common logic like quota tracking, logging, and error standardization.
 */
export abstract class ModelProvider {
    readonly providerId: string;
    protected readonly _logger: Logger;

    protected constructor(providerId: string, label: string) {
        this.providerId = providerId;
        this._logger = makeChildLogger(label);
        this._logger.info(`Initialized ${label} provider`);
    }

    /**
     * Retrieves a list of available model IDs.
     * @returns Promise resolving to an array of model IDs.
     * @throws {ProviderError} If the provider API fails.
     */
    abstract getModels(): Promise<string[]>;

    /**
     * Parses a model ID into a structured format.
     * Handles IDs with or without provider prefixes.
     * Extracts :free suffix, version numbers, and parameter counts.
     *
     * @param modelId - The raw model ID string.
     * @returns The parsed model ID structure.
     */
    static parseModelId(modelId: string): ParsedModelId {
        const parts = modelId.split("/");
        let provider: string = "unknown";
        let rest = modelId;

        if (parts.length >= 2) {
            provider = parts[0] ?? "unknown";
            rest = parts.slice(1).join("/");
        }

        // Handle suffixes like :free
        const suffixParts = rest.split(":");
        const modelName = suffixParts[0] || rest; // Fallback to rest if empty
        const variant = suffixParts.length > 1 ? suffixParts[1] : undefined;
        const isFree = variant === "free";

        // Extract parameter count (e.g., "7b", "32b", "405b")
        // Looks for digits followed by 'b' surrounded by non-word chars or start/end
        const paramMatch = modelName.match(/(?:^|-|_|\b)(\d+b)(?:$|-|_|\b)/i);
        const parameterCount = paramMatch ? paramMatch[1]?.toLowerCase() : undefined;

        // Extract version
        // Strategies:
        // 1. "v" followed by version (v2, v2.1)
        // 2. "r" followed by version (r1) - common in deepseek
        // 3. Explicit version numbers (3.5, 4.1)
        // 4. Single digits that are likely versions (gpt-4, claude-3), avoiding param counts
        let version: string | undefined;

        const vMatch = modelName.match(/(?:^|-)(?:v|r)(\d+(?:\.\d+)*)(?:$|-)/i);
        if (vMatch) {
            version = vMatch[1];
        } else {
            // Look for floating point versions (4.5, 3.5)
            const floatMatch = modelName.match(/(?:^|-)(\d+\.\d+)(?:$|-)/);
            if (floatMatch) {
                version = floatMatch[1];
            } else {
                // Look for single integer versions, but be careful not to match "32b" or dates "2024"
                // We exclude matches that are immediately followed by 'b' (handled by param check)
                // We also try to avoid large numbers which might be dates or context lengths
                const intMatch = modelName.match(/(?:^|-)(\d+)(?:$|-)/);
                if (intMatch) {
                    const val = intMatch[1];
                    if (!val) {
                        return {
                            provider,
                            model: modelName,
                            ...(variant ? { variant } : {}),
                            ...(version ? { version } : {}),
                            ...(parameterCount ? { parameterCount } : {}),
                            isFree,
                            originalId: modelId,
                        };
                    }
                    // Simple heuristic: versions are usually small (< 100), dates/context are large
                    if (parseInt(val, 10) < 100 && !modelName.toLowerCase().includes(`${val}b`)) {
                        version = val;
                    }
                }
            }
        }

        return {
            provider,
            model: modelName,
            ...(variant ? { variant } : {}),
            ...(version ? { version } : {}),
            ...(parameterCount ? { parameterCount } : {}),
            isFree,
            originalId: modelId,
        };
    }

    /**
     * Generates text for a given request.
     * @param request - The generation request parameters.
     * @returns Promise resolving to the generation response.
     * @throws {ProviderError} If generation fails or rate limits are exceeded.
     */
    abstract generateText(request: GenerateTextRequest): Promise<GenerateTextResponse>;

    /**
     * Streams text for a given request.
     * @param request - The generation request parameters.
     * @returns Object containing the text stream and result promises.
     * @throws {ProviderError} If the stream cannot be initiated.
     */
    abstract streamText(request: GenerateTextRequest): StreamTextResult;

    /**
     * Loads the current quota usage for a model from Redis.
     *
     * @remarks
     * Redis keys are structured as `quota:{provider}:{model}:{window}`.
     * The day key's TTL is used to accurately calculate the reset time, ensuring
     * synchronization across multiple instances.
     *
     * @param modelId - The ID of the model to check.
     * @returns The current quota state or null if no data exists.
     */
    protected async _loadModelQuotaState(modelId: string): Promise<ModelQuotaState | null> {
        const encodedModelId = encodeURIComponent(modelId);
        const baseKey = `quota:${this.providerId}:${encodedModelId}`;
        const client = await getRedisClient();

        // Fetch usage counters for minute, hour, and day windows
        // Also fetch the TTL of the day key to calculate the reset time
        const dayKey = `${baseKey}:day`;
        const multi = client.multi();

        multi.mGet([`${baseKey}:minute`, `${baseKey}:hour`, dayKey]);
        multi.pTTL(dayKey); // Get TTL in milliseconds

        const results = await multi.exec();
        if (!results || results.length < 2) {
            this._logger.warn("Unexpected Redis multi result", { modelId, results });
            return { providerId: this.providerId, modelId };
        }
        const values = results[0];
        const dayPttl = results[1];

        if (values instanceof Error || dayPttl instanceof Error) {
            this._logger.warn("Redis error in multi result", { modelId, results });
            return { providerId: this.providerId, modelId };
        }

        const [minStr, hourStr, dayStr] = (values as unknown as (string | null)[]) ?? [];

        this._logger.debug("Loaded raw quota state", { modelId, minStr, hourStr, dayStr, dayPttl });

        const state: ModelQuotaState = {
            providerId: this.providerId,
            modelId,
        };

        // Parse usage values, ignoring missing keys
        if (minStr) {
            const val = parseInt(minStr, 10);
            if (!isNaN(val)) state.minUsage = val;
        }
        if (hourStr) {
            const val = parseInt(hourStr, 10);
            if (!isNaN(val)) state.hourUsage = val;
        }
        if (dayStr) {
            const val = parseInt(dayStr, 10);
            if (!isNaN(val)) state.dayUsage = val;
        }

        // Calculate the exact reset time based on the key's TTL
        // dayPttl: -2 = key missing, -1 = no expiry, >= 0 = ms until expiry
        const pttl = Number(dayPttl);
        if (pttl >= 0) {
            state.dayReset = new Date(Date.now() + pttl);
        } else if (pttl === -1) {
            // Key exists but has no expiry.
            // We can either set it to "never" or just leave it undefined.
            // Leaving it undefined implies no known reset time.
        }
        // If pttl === -2, key doesn't exist, so no reset time needed (usage is 0)

        return state;
    }

    /**
     * Records a request for a model, incrementing usage counters.
     * Enforces rate limits by setting appropriate TTLs on Redis keys.
     *
     * @remarks
     * This method uses Redis multi/exec for atomicity. It calculates TTLs dynamically
     * to ensure counters expire exactly at the end of their respective windows
     * (minute, hour, or day).
     *
     * @param modelId - The ID of the model being used.
     * @returns The updated quota state after incrementing.
     */
    public async recordRequest(modelId: string): Promise<ModelQuotaState> {
        const limits = await this._getModelRateLimits(modelId);

        // Optimization: Skip Redis operations if no limits are configured
        if (!limits.dayLimit && !limits.hourLimit && !limits.minLimit) {
            return { providerId: this.providerId, modelId };
        }

        const encodedModelId = encodeURIComponent(modelId);
        const baseKey = `quota:${this.providerId}:${encodedModelId}`;
        const client = await getRedisClient();

        const multi = client.multi();
        const requestTime = new Date();

        // Determine the reset time for the daily limit
        // Use provider-supplied reset time if available, otherwise default to Midnight UTC
        let nextDayReset = limits.dayReset;
        if (!nextDayReset) {
            nextDayReset = new Date(requestTime);
            nextDayReset.setUTCDate(nextDayReset.getUTCDate() + 1);
            nextDayReset.setUTCHours(0, 0, 0, 0);
        }

        // Define time windows for rate limiting (minute, hour, day)
        // Calculate TTLs to ensure keys expire at the end of their respective windows
        const windows = [
            {
                type: "min",
                limit: limits.minLimit,
                ttl: 60 - requestTime.getSeconds(),
                suffix: ":minute",
            },
            {
                type: "hour",
                limit: limits.hourLimit,
                ttl: 3600 - (requestTime.getMinutes() * 60 + requestTime.getSeconds()),
                suffix: ":hour",
            },
            {
                type: "day",
                limit: limits.dayLimit,
                ttl: Math.floor((nextDayReset.getTime() - requestTime.getTime()) / 1000),
                suffix: ":day",
            },
        ] as const;

        this._logger.debug("Calculated rate limit windows", {
            modelId,
            windows: windows.map((w) => ({ type: w.type, limit: w.limit, ttl: w.ttl })),
        });

        const activeWindows = windows.filter((w) => w.limit !== undefined);

        // Atomically increment counters and set TTLs for all active windows
        for (const w of activeWindows) {
            const key = `${baseKey}${w.suffix}`;
            multi.incr(key);
            multi.expire(key, w.ttl);
        }

        const results = await multi.exec();

        const state: ModelQuotaState = { providerId: this.providerId, modelId };

        // Map Redis results back to the state object
        // Map Redis results back to the state object
        for (const [index, w] of activeWindows.entries()) {
            const result = results[index * 2];
            if (result instanceof Error) {
                this._logger.warn(`Redis error for ${w.type} window`, { error: result, modelId });
                continue;
            }
            const count = result as unknown as number;
            switch (w.type) {
                case "min":
                    state.minUsage = count;
                    break;
                case "hour":
                    state.hourUsage = count;
                    break;
                case "day":
                    state.dayUsage = count;
                    state.dayReset = nextDayReset;
                    break;
            }
        }

        return state;
    }

    /**
     * Retrieves pricing information for a specific model.
     * @param modelId - The model ID.
     */
    protected abstract _getModelPricing(modelId: string): Promise<ModelPricing>;

    /**
     * Retrieves rate limits for a specific model.
     * @param modelId - The model ID.
     */
    protected abstract _getModelRateLimits(modelId: string): Promise<ModelRateLimits>;

    /**
     * Retrieves the current credit info for the provider.
     */
    protected abstract _getCredits(): Promise<ProviderCredits>;

    /**
     * Aggregates all routing-related data for a model.
     * Fetches quota, pricing, limits, and credits in parallel.
     *
     * @param modelId - The model ID to query.
     * @param estimatedInputTokens - Estimated number of input tokens for cost calculation.
     * @param estimatedOutputTokens - Estimated number of output tokens for cost calculation.
     * @returns A comprehensive snapshot of the model's status.
     */
    async getRoutingSnapshot(
        modelId: string,
        estimatedInputTokens: number = 0,
        estimatedOutputTokens: number = 0,
    ): Promise<ModelRoutingSnapshot> {
        // Execute all data fetches in parallel for performance
        const [quotaState, pricing, rateLimits, credits] = await Promise.all([
            this._loadModelQuotaState(modelId),
            this._getModelPricing(modelId),
            this._getModelRateLimits(modelId),
            this._getCredits(),
        ]);

        this._logger.debug("Routing snapshot components fetched", {
            modelId,
            quota: quotaState,
            pricing,
            limits: rateLimits,
            credits,
        });

        // Construct the usage snapshot from the quota state
        const usageSnapshot: ModelUsageSnapshot = {};
        if (quotaState) {
            if (quotaState.minUsage !== undefined) usageSnapshot.minUsage = quotaState.minUsage;
            if (quotaState.hourUsage !== undefined) usageSnapshot.hourUsage = quotaState.hourUsage;
            if (quotaState.dayUsage !== undefined) usageSnapshot.dayUsage = quotaState.dayUsage;
            if (quotaState.dayReset !== undefined) usageSnapshot.dayReset = quotaState.dayReset;
        }

        // Calculate Cost Estimate
        // Pricing is usually per 1k tokens, so we divide by 1000
        const inputCost = ((pricing.pricePer1kInputTokens ?? 0) / 1000) * estimatedInputTokens;
        const outputCost = ((pricing.pricePer1kOutputTokens ?? 0) / 1000) * estimatedOutputTokens;
        const requestCost = pricing.pricePerRequest ?? 0;
        const totalCost = inputCost + outputCost + requestCost;

        return {
            id: modelId,
            providerId: this.providerId,

            // Cost
            isFree: pricing.isFreeTier,
            costEstimate: totalCost,

            // Minute
            minUsage: quotaState?.minUsage,
            minLimit: rateLimits.minLimit,

            // Hour
            hourUsage: quotaState?.hourUsage,
            hourLimit: rateLimits.hourLimit,

            // Day
            dayUsage: quotaState?.dayUsage,
            dayLimit: rateLimits.dayLimit,
            dayReset: quotaState?.dayReset ?? rateLimits.dayReset,
        };
    }

    /**
     * Internal helper to execute a text generation request.
     * Records usage and handles provider-specific errors.
     *
     * @param providerId - The provider ID.
     * @param modelId - The model ID.
     * @param model - The AI SDK model instance.
     * @param options - Generation options.
     */
    protected async _generate<TModel>(
        providerId: string,
        modelId: string,
        model: TModel,
        options: Omit<GenerateTextRequest, "modelId">,
    ): Promise<GenerateTextResponse> {
        const { metadata, ...rest } = options;
        try {
            // Record the request for rate limiting before calling the API
            // Usage recording is now handled by the router to prevent race conditions

            type GenerateArgs = Parameters<typeof generateText>[0];

            const aiArgs: GenerateArgs = {
                ...(rest as GenerateArgs),
                model: model as unknown as GenerateArgs["model"],
            };

            const { text, finishReason, usage, providerMetadata } = await generateText(aiArgs);

            const response: GenerateTextResponse = {
                text,
                finishReason,
                usage,
                ...(providerMetadata !== undefined ? { providerMetadata } : {}),
            };

            return response;
        } catch (error) {
            // Standardize and log errors
            const providerError = toProviderError(providerId, error);
            this._logger.error(`${providerId}.generateText failed`, {
                error: providerError,
                modelId,
                metadata,
            });
            throw providerError;
        }
    }

    /**
     * Internal helper to execute a streaming text generation request.
     * Records usage and wraps the stream to handle errors.
     *
     * @param providerId - The provider ID.
     * @param modelId - The model ID.
     * @param model - The AI SDK model instance.
     * @param options - Generation options.
     */
    protected _stream<TModel>(
        providerId: string,
        modelId: string,
        model: TModel,
        options: Omit<GenerateTextRequest, "modelId">,
    ): StreamTextResult {
        const { metadata, ...rest } = options;
        try {
            type StreamArgs = Parameters<typeof streamText>[0];

            const aiArgs: StreamArgs = {
                ...(rest as StreamArgs),
                model: model as unknown as StreamArgs["model"],
            };

            const result = streamText(aiArgs);

            // Helper to wrap promises with error handling
            const wrapPromise = async <T>(promise: Promise<T>): Promise<T> => {
                try {
                    return await promise;
                } catch (error) {
                    const providerError = toProviderError(providerId, error);
                    this._logger.error(`${providerId}.streamText failed`, {
                        error: providerError,
                        modelId,
                        metadata,
                    });
                    throw providerError;
                }
            };

            // Wrap the text stream to record usage and handle errors during iteration
            const wrappedTextStream: StreamTextResult["textStream"] = (async function* (
                self: ModelProvider,
            ) {
                try {
                    // Usage recording is now handled by the router to prevent race conditions

                    for await (const chunk of result.textStream) {
                        yield chunk;
                    }
                } catch (error) {
                    const providerError = toProviderError(providerId, error);
                    self._logger.error(`${providerId}.streamText failed`, {
                        error: providerError,
                        modelId,
                        metadata,
                    });
                    throw providerError;
                }
            })(this);

            return {
                textStream: wrappedTextStream,
                text: wrapPromise(result.text),
                usage: wrapPromise(result.usage),
            };
        } catch (error) {
            const providerError = toProviderError(providerId, error);
            this._logger.error(`${providerId}.streamText failed`, {
                error: providerError,
                modelId,
                metadata,
            });
            throw providerError;
        }
    }
}
