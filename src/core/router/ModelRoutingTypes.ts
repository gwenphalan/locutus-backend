export interface ModelPricing {
    pricePer1kInputTokens?: number;
    pricePer1kOutputTokens?: number;
    pricePerRequest?: number;
    isFreeTier?: boolean;
}

export interface ModelRateLimits {
    minLimit?: number;
    hourLimit?: number;
    dayLimit?: number;
    dayReset?: Date; // Optional custom reset time
}

export interface ModelUsageSnapshot {
    minUsage?: number;
    hourUsage?: number;
    dayUsage?: number;
    dayReset?: Date;
}

// Merged from ModelQuotaState.ts
export interface ModelQuotaState {
    providerId: string;
    modelId: string;

    minUsage?: number;
    hourUsage?: number;
    dayUsage?: number;
    dayReset?: Date;
}

export interface ModelRoutingSnapshot {
    providerId: string;
    modelId: string;
    pricing: ModelPricing;
    rateLimits: ModelRateLimits;
    usage: ModelUsageSnapshot;
}

export interface ProviderCredits {
    totalCredits: number;
    totalUsage: number;
}
