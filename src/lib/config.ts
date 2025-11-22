import { z } from "zod";

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
        .enum(["error", "warn", "info", "http", "verbose", "debug", "silly"])
        .default("info"),
    OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.format());
    process.exit(1);
}

export const env = parsed.data;
