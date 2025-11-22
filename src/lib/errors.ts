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

export const toAppError = (err: unknown): AppError => {
    if (err instanceof AppError) return err;
    if (err instanceof Error) return new AppError(err.message);
    return new AppError("Unknown error");
};
