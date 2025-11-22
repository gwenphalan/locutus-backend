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

export class ProviderError extends AppError {
    providerId: string;

    constructor(providerId: string, message: string, statusCode = 502, code = "PROVIDER_ERROR") {
        super(message, statusCode, code);
        this.name = "ProviderError";
        this.providerId = providerId;
    }
}

export const toAppError = (err: unknown): AppError => {
    if (err instanceof AppError) return err;
    if (err instanceof Error) return new AppError(err.message);
    return new AppError("Unknown error");
};

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
