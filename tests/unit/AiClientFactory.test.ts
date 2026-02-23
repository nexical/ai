import { describe, it, expect, vi } from "vitest";
import { AiClientFactory } from "../../src/AiClientFactory.js";
import { GeminiCLI } from "../../src/providers/GeminiCLI.js";

vi.mock("../../src/providers/GeminiCLI.js");

describe("AiClientFactory", () => {
  it("should return a GeminiCLI instance by default", () => {
    const client = AiClientFactory.create();
    expect(client).toBeInstanceOf(GeminiCLI);
    expect(GeminiCLI).toHaveBeenCalledWith({});
  });

  it("should return a GeminiCLI instance when explicitly configured", () => {
    const config = { provider: "gemini-cli", apiKey: "test" };
    const client = AiClientFactory.create(config);
    expect(client).toBeInstanceOf(GeminiCLI);
    expect(GeminiCLI).toHaveBeenCalledWith(config);
  });

  it("should throw an error for unsupported provider", () => {
    const config = { provider: "unknown-provider", customSetting: true };

    expect(() => {
      AiClientFactory.create(config);
    }).toThrowError("Unsupported AI Client provider: unknown-provider");
  });
});
