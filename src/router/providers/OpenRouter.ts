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
import { generateText, streamText } from "ai";

export class OpenRouter extends ModelProvider {
    private readonly client: OpenRouterClient;
    private readonly provider: OpenRouterProvider;

    constructor(apiKey: string) {
        super("openrouter", "OpenRouter");
        this.client = new OpenRouterClient({ apiKey });
        this.provider = createOpenRouter({ apiKey });
    }

    async getModels(): Promise<string[]> {
        return cacheClient.wrap(
            "openrouter:models",
            async () => {
                const list = await this.client.models.list();
                return list.data.map((model) => model.id);
            },
            300,
        );
    }

    async generateText(request: GenerateTextRequest): Promise<GenerateTextResponse> {
        const { modelId, metadata, ...options } = request;

        this.logger.debug(`Generating text with model ${modelId}`, { metadata });

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
        };

        if (providerMetadata !== undefined) {
            response.providerMetadata = providerMetadata;
        }

        return response;
    }

    streamText(request: GenerateTextRequest): StreamTextResult {
        const { modelId, metadata, ...options } = request;

        this.logger.debug(`Streaming text with model ${modelId}`, { metadata });

        const model = this.provider.chat(modelId) as unknown as Parameters<
            typeof streamText
        >[0]["model"];

        const aiArgs: Parameters<typeof streamText>[0] = {
            ...(options as Parameters<typeof streamText>[0]),
            model,
        };

        const result = streamText(aiArgs);

        return {
            textStream: result.textStream,
            text: result.text,
            usage: result.usage,
        };
    }
}
