import { ProviderRouter } from "./core/router/ProviderRouter.js";
import { env } from "./lib/config.js";
import { makeChildLogger } from "./lib/logger.js";
import { OpenRouter } from "./router/providers/OpenRouter.js";

const log = makeChildLogger("bootstrap");

const router = new ProviderRouter();

if (env.OPENROUTER_API_KEY != "") router.registerProvider(new OpenRouter(env.OPENROUTER_API_KEY));

log.info(`Locutus backend starting on port ${env.PORT}`);

const test_prompts = [
    {
        id: "reasoning_simple",
        prompt: "Solve this riddle: I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?",
        description: "Simple riddle to test reasoning capabilities",
        expected_answer: "Echo",
        tags: ["reasoning", "riddle"],
    },
    {
        id: "coding_python",
        prompt: "Write a Python function that calculates the Fibonacci sequence up to n terms using a generator.",
        description: "Code generation task testing syntax and logic",
        tags: ["coding", "python"],
    },
    {
        id: "creative_story",
        prompt: "Write a short story about a time traveler who accidentally changes a minor historical event and returns to a wildly different present. Keep it under 200 words.",
        description: "Creative writing with length constraint",
        tags: ["creative", "writing"],
    },
    {
        id: "json_extraction",
        prompt: "Extract the following information from the text into JSON format: 'John Doe (age 34) lives at 123 Maple St, Springfield.' Fields: name, age, address.",
        description: "Structured data extraction",
        tags: ["extraction", "json"],
    },
    {
        id: "math_word_problem",
        prompt: "A train leaves New York traveling at 60 mph. Another train leaves Los Angeles traveling at 80 mph. They are 3000 miles apart. How long until they meet?",
        description: "Mathematical word problem",
        tags: ["math", "reasoning"],
    },
];

const runTestPrompts = async () => {
    for (const p of test_prompts) {
        log.info(`Executing prompt: ${p.id}`);
        try {
            const response = await router.generate(
                {
                    modelId: "x-ai/grok-4.1-fast:free",
                    prompt: p.prompt,
                },
                {
                    maxQueueWaitMs: 10000,
                    jitterMs: 500,
                },
            );
            log.info(`Response for ${p.id}: ${response.text}`);
        } catch (error) {
            log.error(`Failed to execute prompt ${p.id}`, error);
        }
    }
};

runTestPrompts().catch((err) => log.error("Error running test prompts", err));
