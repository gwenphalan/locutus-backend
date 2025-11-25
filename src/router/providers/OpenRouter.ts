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
import type { ModelPricing, ModelRateLimits } from "../../core/router/ModelRoutingTypes.js";
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

    async getModels(): Promise<string[]> {
        try {
            const keyInfo = await this._client.apiKeys.getCurrentKeyMetadata();
            const isFreeUser = keyInfo.data.isFreeTier;
            const tierSuffix = isFreeUser ? "free" : "paid";

            this._logger.debug(`OpenRouter user is on ${isFreeUser ? "free" : "paid"} tier`);

            return await cacheClient.wrap(
                `openrouter:models:${tierSuffix}`,
                async () => {
                    const list = await this._client.models.list();
                    const modelIds = list.data.map((model) => model.id);

                    if (isFreeUser) {
                        return modelIds.filter((modelId) => modelId.endsWith(":free"));
                    }

                    return modelIds;
                },
                300,
            );
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

    // Pricing information for routing; TODO: populate with real OpenRouter metadata.
    // For now, we return an empty object so the router can still operate.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected _getModelPricing(modelId: string): Promise<ModelPricing> {
        return Promise.resolve({});
    }

    // Configured rate limits for this model; TODO: wire real limits from config or metadata.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected _getModelRateLimits(modelId: string): Promise<ModelRateLimits> {
        return Promise.resolve({});
    }

    private async _getCredits(): Promise<GetCreditResponse> {
        try {
            return await cacheClient.wrap<GetCreditResponse>(
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

                    return parsed.data;
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
