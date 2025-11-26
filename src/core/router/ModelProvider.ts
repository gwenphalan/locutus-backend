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
import { type ModelQuotaState } from "./ModelRoutingTypes.js";
import { getRedisClient } from "../../lib/database.js";
import type {
    ModelPricing,
    ModelRateLimits,
    ModelRoutingSnapshot,
    ModelUsageSnapshot,
    ProviderCredits,
} from "./ModelRoutingTypes.js";

export type ModelMessageRole = "system" | "user" | "assistant" | "tool";

export type GenerateTextRequest = CallSettings &
    Prompt & {
        modelId: string;
        tools?: ToolSet;
        toolChoice?: ToolChoice<ToolSet>;
        metadata?: Record<string, unknown>;
    };

export interface GenerateTextResponse {
    text: string;
    finishReason?: string;
    usage?: LanguageModelUsage;
    providerMetadata?: ProviderMetadata;
}

export interface StreamTextResult {
    textStream: AsyncIterable<string>;
    text: Promise<string>;
    usage: Promise<GenerateTextResponse["usage"]>;
}

export abstract class ModelProvider {
    protected readonly _providerId: string;
    protected readonly _logger: Logger;

    protected constructor(providerId: string, label: string) {
        this._providerId = providerId;
        this._logger = makeChildLogger(label);
        this._logger.info(`Initialized ${label} provider`);
    }

    abstract getModels(): Promise<string[]>;

    abstract generateText(request: GenerateTextRequest): Promise<GenerateTextResponse>;

    abstract streamText(request: GenerateTextRequest): StreamTextResult;

    protected async _loadModelQuotaState(modelId: string): Promise<ModelQuotaState | null> {
        const encodedModelId = encodeURIComponent(modelId);
        const baseKey = `quota:${this._providerId}:${encodedModelId}`;
        const client = await getRedisClient();

        // Fetch values AND the TTL for the day key to determine reset time
        const dayKey = `${baseKey}:day`;
        const multi = client.multi();

        multi.mGet([`${baseKey}:minute`, `${baseKey}:hour`, dayKey]);
        multi.pTTL(dayKey); // Get TTL in milliseconds

        const [values, dayPttl] = (await multi.exec()) as unknown as [Array<string | null>, number];
        const [minStr, hourStr, dayStr] = values;

        const state: ModelQuotaState = {
            providerId: this._providerId,
            modelId,
        };

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

        // Calculate dayReset from TTL if key exists (pttl > 0)
        if (dayPttl > 0) {
            state.dayReset = new Date(Date.now() + dayPttl);
        }

        return state;
    }

    protected async _recordRequest(modelId: string): Promise<ModelQuotaState> {
        const limits = await this._getModelRateLimits(modelId);

        // Optimization: If no limits configured, return empty usage
        if (!limits.dayLimit && !limits.hourLimit && !limits.minLimit) {
            return { providerId: this._providerId, modelId };
        }

        const encodedModelId = encodeURIComponent(modelId);
        const baseKey = `quota:${this._providerId}:${encodedModelId}`;
        const client = await getRedisClient();

        const multi = client.multi();
        const requestTime = new Date();

        // Logic: Use provider-supplied reset time if available, otherwise default to Midnight UTC
        let nextDayReset = limits.dayReset;
        if (!nextDayReset) {
            nextDayReset = new Date(requestTime);
            nextDayReset.setUTCDate(nextDayReset.getUTCDate() + 1);
            nextDayReset.setUTCHours(0, 0, 0, 0);
        }

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

        const activeWindows = windows.filter((w) => w.limit !== undefined);

        for (const w of activeWindows) {
            const key = `${baseKey}${w.suffix}`;
            multi.incr(key);
            multi.expire(key, w.ttl);
        }

        const results = await multi.exec();

        const state: ModelQuotaState = { providerId: this._providerId, modelId };

        activeWindows.forEach((w, index) => {
            const count = results[index * 2] as unknown as number;
            state[`${w.type}Usage`] = count;
            if (w.type === "day") state.dayReset = nextDayReset;
        });

        return state;
    }

    protected abstract _getModelPricing(modelId: string): Promise<ModelPricing>;

    protected abstract _getModelRateLimits(modelId: string): Promise<ModelRateLimits>;

    protected abstract _getCredits(): Promise<ProviderCredits>;

    async getRoutingSnapshot(modelId: string): Promise<ModelRoutingSnapshot> {
        const [quotaState, pricing, rateLimits, credits] = await Promise.all([
            this._loadModelQuotaState(modelId),
            this._getModelPricing(modelId),
            this._getModelRateLimits(modelId),
            this._getCredits(),
        ]);

        const usageSnapshot: ModelUsageSnapshot = {};
        if (quotaState) {
            if (quotaState.minUsage !== undefined) usageSnapshot.minUsage = quotaState.minUsage;
            if (quotaState.hourUsage !== undefined) usageSnapshot.hourUsage = quotaState.hourUsage;
            if (quotaState.dayUsage !== undefined) usageSnapshot.dayUsage = quotaState.dayUsage;
            if (quotaState.dayReset !== undefined) usageSnapshot.dayReset = quotaState.dayReset;
        }

        return {
            providerId: this._providerId,
            modelId,
            credits,
            pricing,
            rateLimits,
            usage: usageSnapshot,
        };
    }

    protected async _generate<TModel>(
        providerId: string,
        modelId: string,
        model: TModel,
        options: Omit<GenerateTextRequest, "modelId">,
    ): Promise<GenerateTextResponse> {
        const { metadata, ...rest } = options;
        try {
            await this._recordRequest(modelId);

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
            const providerError = toProviderError(providerId, error);
            this._logger.error(`${providerId}.generateText failed`, {
                error: providerError,
                modelId,
                metadata,
            });
            throw providerError;
        }
    }

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

            const wrappedTextStream: StreamTextResult["textStream"] = (async function* (
                self: ModelProvider,
            ) {
                try {
                    await self._recordRequest(modelId);

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
