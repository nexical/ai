# @nexical/ai

`@nexical/ai` provides generalized AI client interfaces and provider implementations for the Nexical ecosystem. It serves as an abstraction layer for interacting with LLM APIs and CLI tools.

## Installation

```bash
npm install @nexical/ai
```

## Overview

The core of `@nexical/ai` revolves around the `AiClient` interface and the `AiClientFactory` for instantiating providers. Currently, the primary implementation interacts with the Google Gemini CLI via standard streams.

### Interfaces

The library exposes three main types:

```typescript
export interface AiClientResult {
  code: number; // Exit code (0 for success)
  shouldRetry: boolean; // True if the request failed due to rate-limiting (e.g., 429)
  output: string; // The stdout returned by the model
}

export interface AiClientConfig {
  provider?: string; // 'gemini-cli' by default
  commandTemplate?: string; // The template command used to invoke the AI
  [key: string]: unknown;
}

export interface AiClient {
  run(model: string, input: string): Promise<AiClientResult>;
}
```

## Usage

Use the `AiClientFactory` to create an instance of an `AiClient`. By default, the factory initializes a `GeminiCLI` provider.

```typescript
import { AiClientFactory } from "@nexical/ai";

async function generateText() {
  // Instantiate a client using the default configuration
  const aiClient = AiClientFactory.create();

  const prompt = "Explain the theoretical limits of computational complexity.";
  const model = "gemini-3-pro-preview"; // passed to the provider

  // Run the model with the given input
  const result = await aiClient.run(model, prompt);

  if (result.code === 0) {
    console.log("Output:", result.output);
  } else if (result.shouldRetry) {
    console.warn(
      "Rate limited! We should probably rotate the model or hold off.",
    );
  } else {
    console.error("Model execution failed.");
  }
}
```

## Providers

### `GeminiCLI` (Default)

The `GeminiCLI` provider functions by spawning a subprocess running a local CLI client (e.g. Google's `gemini` CLI).

**Characteristics of the `GeminiCLI` Implementation:**

1. **Interactive streaming:** It automatically streams `stdout` to the terminal using `chalk.yellow` for immediate visual feedback.
2. **Subprocess spawning:** It spawns a child process and pipes the input prompt data into the CLI's standard input.
3. **Rate Limit Detection:** Upon process closure, the implementation checks the parsed `stderr` for resource exhaustion strings (`"429"`, `"exhausted your capacity"`, `"ResourceExhausted"`). If the exit code is non-zero and this condition is met, it returns `shouldRetry: true`, signaling to the orchestrator (like `PromptRunner`) that it can rotate to the next available model.

**Configuring `GeminiCLI` Command Output:**
You can override the exact CLI execution by supplying a custom `commandTemplate`:

```typescript
const aiClient = AiClientFactory.create({
  provider: "gemini-cli",
  // {model} is replaced dynamically on runtime
  commandTemplate: 'gemini --yolo -p "" --model {model}',
});
```
