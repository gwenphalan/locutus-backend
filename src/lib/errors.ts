/**
 * Base class for application-specific errors.
 * Includes status code and error code for consistent error handling.
 */
export class AppError extends Error {
    statusCode: number;
    code: string;

    constructor(message: string, statusCode = 500, code = "INTERNAL_ERROR") {
        super(message);
        this.name = "AppError";
        this.statusCode = statusCode;
        this.code = code;
    }
}

/**
 * Error class for provider-related failures (e.g., OpenRouter API errors).
 * Includes the provider ID for context.
 */
export class ProviderError extends AppError {
    providerId: string;

    constructor(providerId: string, message: string, statusCode = 502, code = "PROVIDER_ERROR") {
        super(message, statusCode, code);
        this.name = "ProviderError";
        this.providerId = providerId;
    }
}

/**
 * Converts an unknown error into an AppError.
 * Preserves existing AppErrors, wraps generic Errors, and handles unknown types.
 *
 * @param err - The error to convert.
 * @returns A standardized AppError.
 */
export const toAppError = (err: unknown): AppError => {
    if (err instanceof AppError) return err;
    if (err instanceof Error) return new AppError(err.message);
    return new AppError("Unknown error");
};

/**
 * Converts an unknown error into a ProviderError.
 * Wraps the error with the specific provider ID.
 *
 * @param providerId - The ID of the provider where the error occurred.
 * @param err - The error to convert.
 * @returns A standardized ProviderError.
 */
export const toProviderError = (providerId: string, err: unknown): ProviderError => {
    if (err instanceof ProviderError) return err;
    if (err instanceof AppError) {
        return new ProviderError(providerId, err.message, err.statusCode, err.code);
    }
    if (err instanceof Error) {
        return new ProviderError(providerId, err.message);
    }
    return new ProviderError(providerId, "Unknown provider error");
};
