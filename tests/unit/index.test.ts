import { describe, it, expect } from "vitest";
import * as AiPackage from "../../src/index.js";

describe("Index Exports", () => {
  it("should export all required modules", () => {
    expect(AiPackage.AiClientFactory).toBeDefined();
    expect(AiPackage.PromptRunner).toBeDefined();
    expect(AiPackage.GeminiCLI).toBeDefined();
  });
});
