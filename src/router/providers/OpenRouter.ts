import type { OpenRouterProvider } from "@openrouter/ai-sdk-provider";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { OpenRouter as OpenRouterClient } from "@openrouter/sdk";
import { z } from "zod";
import { ModelProvider } from "../../core/router/ModelProvider.js";
import type {
    GenerateTextRequest,
    GenerateTextResponse,
    StreamTextResult,
} from "../../core/router/ModelProvider.js";
import type {
    ModelPricing,
    ModelRateLimits,
    ProviderCredits,
} from "../../core/router/ModelRoutingTypes.js";
import { cacheClient } from "../../lib/cache.js";
import { toProviderError } from "../../lib/errors.js";

/**
 * Response structure for the OpenRouter credits API.
 */
export interface GetCreditResponse {
    data: {
        total_credits: number;
        total_usage: number;
    };
}

const getCreditResponseSchema = z.object({
    data: z.object({
        total_credits: z.number(),
        total_usage: z.number(),
    }),
});

/**
 * Pricing details for an OpenRouter model.
 * All costs are in USD.
 */
interface PublicPricing {
    /** Cost per input token. */
    prompt: string;
    /** Cost per output token. */
    completion: string;
    /** Fixed cost per request. */
    request?: string;
    /** Cost per image input. */
    image?: string;
    /** Cost per web search. */
    webSearch?: string;
    /** Cost for internal reasoning tokens. */
    internalReasoning?: string;
    /** Cost per cached input token read. */
    inputCacheRead?: string;
    /** Cost per cached input token write. */
    inputCacheWrite?: string;

    // Additional pricing fields
    imageToken?: string;
    imageOutput?: string;
    audio?: string;
    inputAudioCache?: string;
    discount?: number;
}

/**
 * Top provider information for a model.
 */
interface TopProviderInfo {
    contextLength?: number | null;
    maxCompletionTokens?: number | null;
    isModerated: boolean;
}

/**
 * Architecture details of a model.
 */
interface ModelArchitecture {
    tokenizer?: string;
    instructType?: string | null;
    modality: string | null;
    inputModalities: string[];
    outputModalities: string[];
}

/**
 * Structure of a model object returned by the OpenRouter API.
 */
interface OpenRouterModel {
    id: string;
    name: string;
    created: number;
    description?: string;
    pricing: PublicPricing;
    contextLength: number | null;
    architecture: ModelArchitecture;
    topProvider: TopProviderInfo;
    perRequestLimits: Record<string, unknown> | null;
    supportedParameters: string[];
    defaultParameters: Record<string, unknown> | null;
}

/**
 * OpenRouter implementation of the ModelProvider.
 * Handles model fetching, text generation, and credit tracking for OpenRouter.
 *
 * @remarks
 * This class serves as the reference implementation for the `ModelProvider` abstract base class.
 * It demonstrates how to integrate with a third-party AI provider using the Vercel AI SDK.
 */
export class OpenRouter extends ModelProvider {
    private readonly _client: OpenRouterClient;
    private readonly _provider: OpenRouterProvider;
    private readonly _apiKey: string;

    constructor(apiKey: string) {
        super("openrouter", "OpenRouter");
        this._apiKey = apiKey;
        this._client = new OpenRouterClient({ apiKey: this._apiKey });
        this._provider = createOpenRouter({ apiKey: this._apiKey });

        this._logger.info(
            `OpenRouter provider initialized with key: ${this._apiKey.slice(0, 12)}${"*".repeat(this._apiKey.length - 12)}`,
        );
    }

    /**
     * Checks if the current API key belongs to a free tier account.
     * Caches the result for 5 minutes to reduce API calls.
     */
    private async _isFreeTier(): Promise<boolean> {
        return await cacheClient.wrap(
            "openrouter:key-metadata",
            async () => {
                const keyInfo = await this._client.apiKeys.getCurrentKeyMetadata();
                return keyInfo.data.isFreeTier;
            },
            300, // 5 minutes TTL
        );
    }

    /**
     * Fetches and caches the list of available models.
     * Filters models based on the user's tier (free vs paid).
     */
    private async _getCachedModels(): Promise<OpenRouterModel[]> {
        const isFreeUser = await this._isFreeTier();
        const tierSuffix = isFreeUser ? "free" : "paid";
        const keyPrefix = this._apiKey.slice(0, 8);

        return await cacheClient.wrap(
            `openrouter:models:${keyPrefix}:${tierSuffix}`,
            async () => {
                const list = await this._client.models.list();
                const data = list.data as unknown as OpenRouterModel[];

                // Filter for free models if the user is on the free tier
                if (isFreeUser) {
                    return data.filter((model) => model.id.endsWith(":free"));
                }

                return data;
            },
            300,
        );
    }

    /**
     * Calculates the next midnight UTC.
     * Used for rate limit resets.
     */
    private _getMidnightUTC(): Date {
        const date = new Date();
        // setUTCHours(24) correctly advances to the next day's 00:00:00 UTC
        date.setUTCHours(24, 0, 0, 0);
        return date;
    }

    /**
     * Retrieves available model IDs.
     * Handles tier-based filtering and error wrapping.
     *
     * @remarks
     * Models are cached for 5 minutes to avoid hitting OpenRouter's rate limits.
     * Free tier users only see models ending in `:free`.
     *
     * @returns Promise resolving to an array of model IDs.
     * @throws {ProviderError} If the API call fails or returns invalid data.
     */
    async getModels(): Promise<string[]> {
        try {
            const isFreeUser = await this._isFreeTier();
            this._logger.debug(`OpenRouter user is on ${isFreeUser ? "free" : "paid"} tier`);

            const models = await this._getCachedModels();
            this._logger.debug(`Fetched ${models.length} models from OpenRouter`);
            return models.map((m: OpenRouterModel) => m.id);
        } catch (error) {
            const providerError = toProviderError("openrouter", error);
            this._logger.error("OpenRouter.getModels failed", { error: providerError });
            throw providerError;
        }
    }

    /**
     * Generates text using the OpenRouter API.
     */
    async generateText(request: GenerateTextRequest): Promise<GenerateTextResponse> {
        const { modelId, ...options } = request;

        const model = this._provider.chat(modelId);

        return this._generate("openrouter", modelId, model, options);
    }

    /**
     * Streams text using the OpenRouter API.
     */
    streamText(request: GenerateTextRequest): StreamTextResult {
        const { modelId, ...options } = request;

        const model = this._provider.chat(modelId);

        return this._stream("openrouter", modelId, model, options);
    }

    /**
     * Retrieves pricing for a specific model from the cached model list.
     */
    protected async _getModelPricing(modelId: string): Promise<ModelPricing> {
        try {
            const models = await this._getCachedModels();
            const model = models.find((m: OpenRouterModel) => m.id === modelId);

            if (!model || !model.pricing) {
                return {};
            }

            const p = model.pricing;
            const pricing = {
                pricePer1kInputTokens: parseFloat(p.prompt) * 1000 || 0,
                pricePer1kOutputTokens: parseFloat(p.completion) * 1000 || 0,
                pricePerRequest: p.request ? (parseFloat(p.request) || 0) : 0,
                isFreeTier: model.id.endsWith(":free"),
            };
            this._logger.debug("Parsed model pricing", { modelId, pricing });
            return pricing;
        } catch (error) {
            this._logger.warn(`Failed to get pricing for ${modelId}`, { error });
            return {};
        }
    }

    /**
     * Determines rate limits based on user tier and model type.
     * Enforces stricter limits for free models.
     */
    protected async _getModelRateLimits(modelId: string): Promise<ModelRateLimits> {
        const isFreeUser = await this._isFreeTier();
        const isFreeModel = modelId.endsWith(":free");
        const nextMidnight = this._getMidnightUTC();

        if (isFreeModel) {
            // Paid user using free model: 20 RPM, 1000 RPD
            const limits = {
                minLimit: 20,
                dayLimit: isFreeUser ? 50 : 1000,
                dayReset: nextMidnight,
            };
            this._logger.debug("Applied free model limits", { modelId, isFreeUser, limits });
            return limits;
        }

        // Paid user using paid model: No limits
        return {};
    }

    /**
     * Fetches total credits purchased and total credits used from OpenRouter API.
     * Caches the result for 5 minutes.
     *
     * @returns Promise resolving to the credit balance.
     * @throws {ProviderError} If the API call fails or returns invalid data.
     */
    protected async _getCredits(): Promise<ProviderCredits> {
        try {
            return await cacheClient.wrap<ProviderCredits>(
                "openrouter:credits",
                async () => {
                    const response = await fetch("https://openrouter.ai/api/v1/credits", {
                        headers: {
                            Authorization: `Bearer ${this._apiKey}`,
                        },
                    });

                    if (!response.ok) {
                        throw new Error(`Unexpected OpenRouter credits status: ${response.status}`);
                    }

                    const body = (await response.json()) as unknown;
                    const parsed = getCreditResponseSchema.safeParse(body);

                    if (!parsed.success) {
                        throw new Error(
                            `Invalid OpenRouter credits response: ${parsed.error.message}`,
                        );
                    }

                    return {
                        totalCredits: parsed.data.data.total_credits,
                        totalUsage: parsed.data.data.total_usage,
                    };
                },
                300,
            );
        } catch (error) {
            const providerError = toProviderError("openrouter", error);
            this._logger.error("OpenRouter._getCredits failed", { error: providerError });
            throw providerError;
        }
    }
}
