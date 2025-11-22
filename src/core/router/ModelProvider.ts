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

export type ModelMessageRole = "system" | "user" | "assistant" | "tool";

export type GenerateTextRequest = CallSettings &
    Prompt & {
        // Provider-specific model identifier; adapters map this to a LanguageModel.
        modelId: string;
        tools?: ToolSet;
        toolChoice?: ToolChoice<ToolSet>;
        /** Optional app-specific metadata; not sent to ai.generateText. */
        metadata?: Record<string, unknown>;
    };

export interface GenerateTextResponse {
    text: string;
    finishReason?: string;
    usage?: LanguageModelUsage;
    providerMetadata?: ProviderMetadata;
}

export interface StreamTextResult {
    /** Async iterator of text deltas */
    textStream: AsyncIterable<string>;
    /** Resolve to full text after stream consumption */
    text: Promise<string>;
    /** Usage info after stream ends */
    usage: Promise<GenerateTextResponse["usage"]>;
}

export abstract class ModelProvider {
    protected readonly providerId: string;
    protected readonly logger: Logger;

    protected constructor(providerId: string, label: string) {
        this.providerId = providerId;
        this.logger = makeChildLogger(label);
        this.logger.info(`Initialized ${label} provider`);
    }

    abstract getModels(): Promise<string[]>;

    abstract generateText(request: GenerateTextRequest): Promise<GenerateTextResponse>;

    abstract streamText(request: GenerateTextRequest): StreamTextResult;
}
