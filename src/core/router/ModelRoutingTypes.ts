/**
 * Pricing information for a model.
 * All prices are in USD.
 */
export interface ModelPricing {
    /** Cost per 1000 input tokens. */
    pricePer1kInputTokens?: number;
    /** Cost per 1000 output tokens. */
    pricePer1kOutputTokens?: number;
    /** Fixed cost per request. */
    pricePerRequest?: number;
    /** Whether the model is currently free to use. */
    isFreeTier?: boolean;
}

/**
 * Rate limits for a model.
 * Defines constraints on request frequency and volume.
 */
export interface ModelRateLimits {
    /** Maximum requests per minute. */
    minLimit?: number;
    /** Maximum requests per hour. */
    hourLimit?: number;
    /** Maximum requests per day. */
    dayLimit?: number;
    /** Optional custom reset time for the daily limit, otherwise assumes 00:00 UTC */
    dayReset?: Date;
}

/**
 * Snapshot of current usage for a model.
 * Used for making routing decisions based on remaining quota.
 */
export interface ModelUsageSnapshot {
    /** Requests made in the current minute. */
    minUsage?: number;
    /** Requests made in the current hour. */
    hourUsage?: number;
    /** Requests made in the current day. */
    dayUsage?: number;
    /** Time when the daily usage counter resets. */
    dayReset?: Date;
}

/**
 * Internal state tracking usage quotas for a specific model provider and model.
 */
export interface ModelQuotaState {
    providerId: string;
    modelId: string;

    minUsage?: number;
    hourUsage?: number;
    dayUsage?: number;
    dayReset?: Date;
}

/**
 * Comprehensive snapshot of a model's routing status.
 * Includes credits, pricing, rate limits, and current usage.
 */
export interface ModelRoutingSnapshot {
    providerId: string;
    modelId: string;
    credits: ProviderCredits;
    pricing: ModelPricing;
    rateLimits: ModelRateLimits;
    usage: ModelUsageSnapshot;
}

/**
 * Credit balance information for a provider.
 * Balance is total credits purchased minus total credits used.
 */
export interface ProviderCredits {
    /** Total credits purchased. */
    totalCredits: number;
    /** Total credits used so far. */
    totalUsage: number;
}
