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

interface PublicPricing {
    prompt: string; // Cost per input token in USD (e.g., "$0.0000005" = $0.50 per 1M tokens)
    completion: string; // Cost per output token in USD (e.g., "$0.0000015" = $1.50 per 1M tokens)
    request?: string; // Fixed cost per API request in USD
    image?: string; // Cost per image input in USD
    webSearch?: string; // Cost per web search operation in USD
    internalReasoning?: string; // Cost for internal reasoning tokens in USD
    inputCacheRead?: string; // Cost per cached input token read in USD
    inputCacheWrite?: string; // Cost per cached input token write in USD

    // Additional pricing fields
    imageToken?: string; // Cost per image token in USD
    imageOutput?: string; // Cost per generated image in USD
    audio?: string; // Cost per audio processing in USD
    inputAudioCache?: string; // Cost per cached audio input in USD
    discount?: number; // Discount percentage as a decimal (e.g., 0.1 = 10% discount)
}

interface TopProviderInfo {
    contextLength?: number | null;
    maxCompletionTokens?: number | null;
    isModerated: boolean;
}

interface ModelArchitecture {
    tokenizer?: string;
    instructType?: string | null;
    modality: string | null;
    inputModalities: string[];
    outputModalities: string[];
}

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

    private async _getCachedModels(): Promise<OpenRouterModel[]> {
        const isFreeUser = await this._isFreeTier();
        const tierSuffix = isFreeUser ? "free" : "paid";

        return await cacheClient.wrap(
            `openrouter:models:${tierSuffix}`,
            async () => {
                const list = await this._client.models.list();
                const data = list.data as unknown as OpenRouterModel[];

                if (isFreeUser) {
                    return data.filter((model) => model.id.endsWith(":free"));
                }

                return data;
            },
            300,
        );
    }

    private _getMidnightUTC(): Date {
        const date = new Date();
        // setUTCHours(24) correctly advances to the next day's 00:00:00 UTC
        date.setUTCHours(24, 0, 0, 0);
        return date;
    }

    async getModels(): Promise<string[]> {
        try {
            const isFreeUser = await this._isFreeTier();
            this._logger.debug(`OpenRouter user is on ${isFreeUser ? "free" : "paid"} tier`);

            const models = await this._getCachedModels();
            return models.map((m: OpenRouterModel) => m.id);
        } catch (error) {
            const providerError = toProviderError("openrouter", error);
            this._logger.error("OpenRouter.getModels failed", { error: providerError });
            throw providerError;
        }
    }

    async generateText(request: GenerateTextRequest): Promise<GenerateTextResponse> {
        const { modelId, ...options } = request;

        const model = this._provider.chat(modelId);

        return this._generate("openrouter", modelId, model, options);
    }

    streamText(request: GenerateTextRequest): StreamTextResult {
        const { modelId, ...options } = request;

        const model = this._provider.chat(modelId);

        return this._stream("openrouter", modelId, model, options);
    }

    protected async _getModelPricing(modelId: string): Promise<ModelPricing> {
        try {
            const models = await this._getCachedModels();
            const model = models.find((m: OpenRouterModel) => m.id === modelId);

            if (!model || !model.pricing) {
                return {};
            }

            const p = model.pricing;
            return {
                pricePer1kInputTokens: parseFloat(p.prompt) * 1000,
                pricePer1kOutputTokens: parseFloat(p.completion) * 1000,
                pricePerRequest: p.request ? parseFloat(p.request) : 0,
                isFreeTier: model.id.endsWith(":free"),
            };
        } catch (error) {
            this._logger.warn(`Failed to get pricing for ${modelId}`, { error });
            return {};
        }
    }

    protected async _getModelRateLimits(modelId: string): Promise<ModelRateLimits> {
        const isFreeUser = await this._isFreeTier();
        const isFreeModel = modelId.endsWith(":free");
        const nextMidnight = this._getMidnightUTC();

        if (isFreeModel) {
            // Paid user using free model: 20 RPM, 1000 RPD
            return {
                minLimit: 20,
                dayLimit: isFreeUser ? 50 : 1000,
                dayReset: nextMidnight,
            };
        }

        // Paid user using paid model: No limits
        return {};
    }

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
