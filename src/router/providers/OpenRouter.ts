import type { OpenRouterProvider } from "@openrouter/ai-sdk-provider";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { OpenRouter as OpenRouterClient } from "@openrouter/sdk";
import {
    ModelProvider,
    type GenerateTextRequest,
    type GenerateTextResponse,
    type StreamTextResult,
} from "../../core/router/ModelProvider.js";
import { cacheClient } from "../../lib/cache.js";
import { toProviderError } from "../../lib/errors.js";
import { generateText, streamText } from "ai";

export class OpenRouter extends ModelProvider {
    private readonly client: OpenRouterClient;
    private readonly provider: OpenRouterProvider;
    private readonly apiKey: string;

    constructor(apiKey: string) {
        super("openrouter", "OpenRouter");
        this.apiKey = apiKey;
        this.client = new OpenRouterClient({ apiKey: this.apiKey });
        this.provider = createOpenRouter({ apiKey: this.apiKey });
    }

    async getModels(): Promise<string[]> {
        try {
            const keyInfo = await this.client.apiKeys.getCurrentKeyMetadata();
            const isFreeUser = keyInfo.data.isFreeTier;
            const tierSuffix = isFreeUser ? "free" : "paid";

            return await cacheClient.wrap(
                `openrouter:models:${tierSuffix}`,
                async () => {
                    const list = await this.client.models.list();
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
            this.logger.error("OpenRouter.getModels failed", { error: providerError });
            throw providerError;
        }
    }

    async generateText(request: GenerateTextRequest): Promise<GenerateTextResponse> {
        const { modelId, metadata, ...options } = request;

        try {
            const model = this.provider.chat(modelId) as unknown as Parameters<
                typeof generateText
            >[0]["model"];

            const aiArgs: Parameters<typeof generateText>[0] = {
                ...(options as Parameters<typeof generateText>[0]),
                model,
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
            const providerError = toProviderError("openrouter", error);
            this.logger.error("OpenRouter.generateText failed", {
                error: providerError,
                modelId,
                metadata,
            });
            throw providerError;
        }
    }

    streamText(request: GenerateTextRequest): StreamTextResult {
        const { modelId, metadata, ...options } = request;

        try {
            const { logger } = this;

            const model = this.provider.chat(modelId) as unknown as Parameters<
                typeof streamText
            >[0]["model"];

            const aiArgs: Parameters<typeof streamText>[0] = {
                ...(options as Parameters<typeof streamText>[0]),
                model,
            };

            const result = streamText(aiArgs);

            const wrappedTextStream: StreamTextResult["textStream"] = (async function* () {
                try {
                    for await (const chunk of result.textStream) {
                        yield chunk;
                    }
                } catch (error) {
                    const providerError = toProviderError("openrouter", error);
                    logger.error("OpenRouter.streamText failed", {
                        error: providerError,
                        modelId,
                        metadata,
                    });
                    throw providerError;
                }
            })();

            const wrappedText: StreamTextResult["text"] = (async () => {
                try {
                    return await result.text;
                } catch (error) {
                    const providerError = toProviderError("openrouter", error);
                    logger.error("OpenRouter.streamText failed", {
                        error: providerError,
                        modelId,
                        metadata,
                    });
                    throw providerError;
                }
            })();

            const wrappedUsage: StreamTextResult["usage"] = (async () => {
                try {
                    return await result.usage;
                } catch (error) {
                    const providerError = toProviderError("openrouter", error);
                    logger.error("OpenRouter.streamText failed", {
                        error: providerError,
                        modelId,
                        metadata,
                    });
                    throw providerError;
                }
            })();

            return {
                textStream: wrappedTextStream,
                text: wrappedText,
                usage: wrappedUsage,
            };
        } catch (error) {
            const providerError = toProviderError("openrouter", error);
            this.logger.error("OpenRouter.streamText failed", {
                error: providerError,
                modelId,
                metadata,
            });
            throw providerError;
        }
    }
}
