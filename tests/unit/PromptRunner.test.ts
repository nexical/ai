import { describe, it, expect, vi, beforeEach } from "vitest";
import { PromptRunner } from "../../src/PromptRunner.js";
import { AiClientFactory } from "../../src/AiClientFactory.js";
import { pack } from "repomix";
import { globSync } from "glob";
import fs from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import * as readline from "node:readline";
import nunjucks from "nunjucks";

vi.mock("node:fs/promises");
vi.mock("node:fs");
vi.mock("repomix");
vi.mock("glob");
vi.mock("node:readline");
vi.mock("../../src/AiClientFactory.js");

describe("PromptRunner", () => {
  let mockAiClient: { run: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.resetAllMocks();

    mockAiClient = {
      run: vi.fn(),
    };
    vi.mocked(AiClientFactory.create).mockReturnValue(mockAiClient);

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(statSync).mockReturnValue({ isFile: () => true } as never);
    vi.mocked(fs.readFile).mockResolvedValue("Mocked file content");
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);
    vi.mocked(globSync).mockReturnValue(["/fake/path.ts"]);
  });

  describe("File Resolution & Setup", () => {
    it("should log error and return 1 if prompt file not found", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await PromptRunner.run({
        promptName: "missing-prompt",
        promptDirs: ["/fake/dir"],
      });

      expect(result).toBe(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("not found in any of the search directories"),
      );
      consoleSpy.mockRestore();
    });

    it("should append .md if missing from promptName", async () => {
      vi.mocked(existsSync).mockImplementation((p: unknown) =>
        String(p).endsWith("hello.md"),
      );
      vi.mocked(fs.readFile).mockResolvedValue("content");
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "hello", promptDirs: ["/fake"] });

      expect(existsSync).toHaveBeenCalledWith(
        expect.stringContaining("hello.md"),
      );
    });

    it("should log error and return 1 if fs.readFile throws reading template", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.mocked(existsSync).mockImplementation((p: unknown) =>
        String(p).endsWith("hello.md"),
      );
      vi.mocked(fs.readFile).mockRejectedValueOnce(new Error("Read failed"));

      const result = await PromptRunner.run({
        promptName: "hello",
        promptDirs: ["/fake"],
      });
      expect(result).toBe(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error reading prompt file: Read failed"),
      );
      consoleSpy.mockRestore();
    });

    it("should log String(error) if fs.readFile throws non-Error reading template", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.mocked(existsSync).mockImplementation((p: unknown) =>
        String(p).endsWith("hello.md"),
      );
      vi.mocked(fs.readFile).mockRejectedValueOnce("String throw fail");

      const result = await PromptRunner.run({
        promptName: "hello",
        promptDirs: ["/fake"],
      });
      expect(result).toBe(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error reading prompt file: String throw fail"),
      );
      consoleSpy.mockRestore();
    });

    it("should clear temp file correctly", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue("content");
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });
      await PromptRunner.run({ promptName: "hello", promptDirs: ["/fake"] });
      expect(fs.unlink).toHaveBeenCalledWith(
        expect.stringContaining(".temp_prompt_"),
      );
    });

    it("should ignore temp file unlink if it fails", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue("content");
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });
      vi.mocked(fs.unlink).mockRejectedValueOnce(new Error("unlink error"));

      const result = await PromptRunner.run({
        promptName: "hello",
        promptDirs: ["/fake"],
      });
      expect(result).toBe(0);
    });

    it("should return 1 if template rendering fails", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.mocked(existsSync).mockImplementation((p: unknown) =>
        String(p).endsWith("hello.md"),
      );
      vi.mocked(fs.readFile).mockResolvedValue("{{ invalid_syntax");

      // Force Nunjucks to throw
      const renderSpy = vi
        .spyOn(nunjucks.Environment.prototype, "renderString")
        .mockImplementation(() => {
          throw new Error("Nunjucks fake syntax error");
        });

      const result = await PromptRunner.run({
        promptName: "hello",
        promptDirs: ["/fake"],
      });
      expect(result).toBe(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Template render error: Error: Nunjucks fake syntax error",
        ),
      );
      consoleSpy.mockRestore();
      renderSpy.mockRestore();
    });
  });

  describe("Globals helpers - context", () => {
    it("should return path not found if input does not exist", async () => {
      vi.mocked(existsSync).mockImplementation((p: unknown) =>
        String(p).endsWith("basic.md") ? true : false,
      );
      vi.mocked(fs.readFile).mockResolvedValue('{{ context("bad_path") }}');
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("[Path not found: bad_path]"),
      );
    });

    it("should read file directly if it is a file", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ isFile: () => true } as never);
      vi.mocked(fs.readFile).mockImplementation((p: unknown) => {
        if (String(p).includes("basic.md"))
          return Promise.resolve('{{ context("dev.ts") }}');
        return Promise.resolve("DEV_CODE");
      });
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('<CODEBASE_CONTEXT path="dev.ts">'),
      );
      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("DEV_CODE"),
      );
    });

    it("should run repomix if it is a directory", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ isFile: () => false } as never);
      vi.mocked(fs.readFile).mockImplementation((p: unknown) => {
        if (String(p).includes("basic.md"))
          return Promise.resolve('{{ context("dir") }}');
        if (String(p).includes("repomix-output"))
          return Promise.resolve("REPOMIX_DATA");
        return Promise.resolve("");
      });
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(pack).toHaveBeenCalled();
      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("REPOMIX_DATA"),
      );
    });

    it("should handle unlink error gracefully when unpacking repomix output", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ isFile: () => false } as never);
      vi.mocked(fs.readFile).mockImplementation((p: unknown) => {
        if (String(p).includes("basic.md"))
          return Promise.resolve('{{ context("dir") }}');
        return Promise.resolve("REPOMIX_DATA");
      });
      vi.mocked(fs.unlink).mockRejectedValue(new Error("mock unlink failure"));
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("REPOMIX_DATA"),
      );
    });

    it("should catch errors when repomix fails", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ isFile: () => false } as never);
      vi.mocked(fs.readFile).mockImplementation((p: unknown) => {
        if (String(p).includes("basic.md"))
          return Promise.resolve('{{ context("dir") }}');
        return Promise.resolve("");
      });
      vi.mocked(pack).mockRejectedValueOnce(new Error("Repomix failed!"));
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("[Error generating context for dir]"),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Context] Error generating context for dir"),
      );
      consoleSpy.mockRestore();
    });
  });

  describe("Globals helpers - read", () => {
    it("should return error if path not found (single string)", async () => {
      vi.mocked(existsSync).mockImplementation((p: unknown) =>
        String(p).endsWith("basic.md") ? true : false,
      );
      vi.mocked(fs.readFile).mockResolvedValue('{{ read("not_exist.ts") }}');
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("[File not found:"),
      );
    });

    it("should return file content for single string path", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockImplementation((p: unknown) => {
        if (String(p).endsWith("basic.md"))
          return Promise.resolve('{{ read("exist.ts") }}');
        return Promise.resolve("EXIST_CONTENT");
      });
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("EXIST_CONTENT"),
      );
    });

    it("should read array of strings, resolving those that exist", async () => {
      vi.mocked(existsSync).mockImplementation(
        (p: unknown) => !String(p).includes("bad.ts"),
      );
      vi.mocked(fs.readFile).mockImplementation((p: unknown) => {
        if (String(p).endsWith("basic.md"))
          return Promise.resolve('{{ read(["good.ts", "bad.ts"]) | safe }}');
        return Promise.resolve("GOOD_CONTENT");
      });
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("GOOD_CONTENT"),
      );
      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("[File not found:"),
      );
    });

    it("should parse comma-separated string correctly", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockImplementation((p: unknown) => {
        if (String(p).endsWith("basic.md"))
          return Promise.resolve('{{ read("file1.ts, file2.ts") | safe }}');
        return Promise.resolve("FILE_CONTENT");
      });
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("FILE_CONTENT\n\nFILE_CONTENT"),
      );
    });

    it("should return error if file not found in comma-separated list", async () => {
      vi.mocked(existsSync).mockImplementation(
        (p: unknown) => !String(p).includes("missing"),
      );
      vi.mocked(fs.readFile).mockImplementation((p: unknown) => {
        if (String(p).endsWith("basic.md"))
          return Promise.resolve('{{ read("found.ts, missing.ts") | safe }}');
        return Promise.resolve("FILE_CONTENT");
      });
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("FILE_CONTENT\n\n[File not found:"),
      );
    });

    it("should catch arbitrary fs reading errors", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockImplementation((p: unknown) => {
        if (String(p).endsWith("basic.md"))
          return Promise.resolve('{{ read("file1.ts") | safe }}');
        return Promise.reject(new Error("FS Read fail"));
      });
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Read] Error reading file: file1.ts"),
      );
      consoleSpy.mockRestore();
    });
  });

  describe("Globals helpers - read_glob / read_specs", () => {
    it("should return error if glob yields no files", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(globSync).mockReturnValue([]);
      vi.mocked(fs.readFile).mockResolvedValue('{{ read_glob("*.bad") }}');
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("[No files found for pattern: *.bad]"),
      );
    });

    it("should read all files matched by glob", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(globSync).mockReturnValue(["/file1.ts", "/file2.ts"]);
      vi.mocked(fs.readFile).mockImplementation((p: unknown) => {
        if (String(p).endsWith("basic.md"))
          return Promise.resolve('{{ read_glob("*.ts") | safe }}');
        if (String(p).includes("file1")) return Promise.resolve("CONTENT1");
        if (String(p).includes("file2")) return Promise.resolve("CONTENT2");
        return Promise.resolve("");
      });
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("CONTENT1"),
      );
      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("CONTENT2"),
      );
    });

    it("should handle fs error on one of the specific glob files loosely", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(globSync).mockReturnValue(["/file1.ts", "/file2.ts"]);
      vi.mocked(fs.readFile).mockImplementation((p: unknown) => {
        if (String(p).endsWith("basic.md"))
          return Promise.resolve('{{ read_specs("*.ts") | safe }}'); // testing read_specs alias
        if (String(p).includes("file1")) return Promise.resolve("CONTENT1");
        if (String(p).includes("file2"))
          return Promise.reject(new Error("fail"));
        return Promise.resolve("");
      });
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("CONTENT1"),
      );
      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("[Error reading file /file2.ts]"),
      );
    });

    it("should catch glob errors completely", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(globSync).mockImplementation(() => {
        throw new Error("Glob crashed");
      });
      vi.mocked(fs.readFile).mockResolvedValue('{{ read_glob("*.ts") }}');
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic", promptDirs: ["/fake"] });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[ReadGlob] Error with pattern: *.ts"),
        expect.any(Error),
      );
      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("[Error processing glob: *.ts]"),
      );
      consoleSpy.mockRestore();
    });
  });

  describe("Globals helpers - compressed_map", () => {
    it("should run repomix to get a compressed map tree", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockImplementation((p: unknown) => {
        if (String(p).includes("basic.md"))
          return Promise.resolve('{{ compressed_map("target_dir") }}');
        if (String(p).includes("repomix-output"))
          return Promise.resolve("MAP_DATA");
        return Promise.resolve("");
      });
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(pack).toHaveBeenCalled();
      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("MAP_DATA"),
      );
      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('<COMPRESSED_MAP path="target_dir">'),
      );
    });

    it("should ignore temp unlink failures smoothly", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockImplementation((p: unknown) => {
        if (String(p).includes("basic.md"))
          return Promise.resolve('{{ compressed_map("target_dir") }}');
        if (String(p).includes("repomix-output"))
          return Promise.resolve("MAP_DATA");
        return Promise.resolve("");
      });
      vi.mocked(fs.unlink).mockRejectedValueOnce(new Error("unlink fail"));
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("MAP_DATA"),
      );
    });

    it("should catch pack failures cleanly", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockImplementation((p: unknown) => {
        if (String(p).includes("basic.md"))
          return Promise.resolve('{{ compressed_map("target_dir") }}');
        return Promise.resolve("");
      });
      vi.mocked(pack).mockRejectedValue(new Error("fail run"));
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[Context] Error generating map for target_dir:",
        ),
      );
      expect(mockAiClient.run).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("[Error generating map for target_dir]"),
      );
      consoleSpy.mockRestore();
    });
  });

  describe("Rendering Edge Cases", () => {
    it("should handle unresolvable async variables", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockImplementation((p: unknown) => {
        if (String(p).includes("basic.md"))
          return Promise.resolve('{{ read("file") }}');
        return Promise.resolve("");
      });
      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "",
      });

      const originalEntries = Map.prototype.entries;
      const mapSpy = vi
        .spyOn(Map.prototype, "entries")
        .mockImplementationOnce(function (this: Map<unknown, unknown>) {
          const entries = Array.from(originalEntries.call(this));
          if (entries.length > 0) {
            entries[0][1] = Promise.reject(
              new Error("Mocked promise rejection"),
            );
          }
          return entries[Symbol.iterator]();
        });

      await PromptRunner.run({ promptName: "basic.md", promptDirs: ["/fake"] });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Render] Failed to resolve async variable"),
      );
      consoleSpy.mockRestore();
      mapSpy.mockRestore();
    });
  });

  describe("AI Client Loops & Exits", () => {
    it("should retry on shouldRetry=true and stop when another works", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue("Prompt content");

      mockAiClient.run
        .mockResolvedValueOnce({ code: 1, shouldRetry: true, output: "" })
        .mockResolvedValueOnce({
          code: 0,
          shouldRetry: false,
          output: "Success",
        });

      const result = await PromptRunner.run({
        promptName: "basic.md",
        promptDirs: ["/fake"],
        models: ["model1", "model2"],
      });

      expect(result).toBe(0);
    });

    it("should fallback sequentially and then fail if all models fail", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue("Prompt content");

      mockAiClient.run.mockResolvedValue({
        code: 2,
        shouldRetry: false,
        output: "",
      });

      const result = await PromptRunner.run({
        promptName: "basic.md",
        promptDirs: ["/fake"],
        models: ["model1", "model2"],
      });

      expect(result).toBe(2);
      expect(mockAiClient.run).toHaveBeenCalledTimes(1); // the first one says shouldRetry=false, so it breaks! Wait, does it break?
      // `if (result.shouldRetry) continue; else break;` YES!
    });

    it("should promote code 0 to 1 if it falls through failure loop", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue("Prompt content");
      // Mock a non-zero code but shouldRetry=true to keep finalCode = 0 unchanged
      mockAiClient.run.mockResolvedValue({
        code: 99,
        shouldRetry: true,
        output: "",
      });

      const result = await PromptRunner.run({
        promptName: "basic",
        promptDirs: ["/fake"],
        models: ["model1"],
      });

      expect(result).toBe(1);
    });
  });

  describe("Interactive Mode", () => {
    it("should ask user if interactive=true, and allow typing prompt", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue("Prompt content");

      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "AI speaks",
      });

      // Mock readline to answer 'Next question' then 'exit'
      let callCount = 0;
      const mockRl = {
        question: vi.fn((q, cb) => {
          callCount++;
          if (callCount === 1) cb("Next question");
          else cb("exit");
        }),
        close: vi.fn(),
      };
      vi.mocked(readline.createInterface).mockReturnValue(mockRl as never);
      const consoleInfoSpy = vi
        .spyOn(console, "info")
        .mockImplementation(() => {});

      const result = await PromptRunner.run({
        promptName: "basic",
        promptDirs: ["/fake"],
        models: ["model1"],
        interactive: true,
      });

      expect(result).toBe(0);
      expect(mockAiClient.run).toHaveBeenCalledTimes(2);
      expect(mockAiClient.run).toHaveBeenNthCalledWith(
        1,
        "model1",
        "Prompt content",
      );
      expect(mockAiClient.run).toHaveBeenNthCalledWith(
        2,
        "model1",
        expect.stringContaining("User: Next question"),
      );

      consoleInfoSpy.mockRestore();
    });

    it("should allow typing quit", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue("Prompt content");

      mockAiClient.run.mockResolvedValue({
        code: 0,
        shouldRetry: false,
        output: "AI speaks",
      });

      const mockRl = {
        question: vi.fn((q, cb) => cb("quit")),
        close: vi.fn(),
      };
      vi.mocked(readline.createInterface).mockReturnValue(mockRl as never);
      const consoleInfoSpy = vi
        .spyOn(console, "info")
        .mockImplementation(() => {});

      await PromptRunner.run({
        promptName: "basic",
        promptDirs: ["/fake"],
        models: ["model1"],
        interactive: true,
      });

      expect(mockAiClient.run).toHaveBeenCalledTimes(1);
      consoleInfoSpy.mockRestore();
    });
  });
});
