import { existsSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import nunjucks from "nunjucks";
import { pack } from "repomix";
import { globSync } from "glob";
import { AiClientFactory } from "./AiClientFactory.js";
import type { AiClientConfig } from "./types.js";
import * as readline from "node:readline";

export interface PromptRunnerOptions {
  promptName: string;
  promptDirs: string[];
  args?: Record<string, unknown>;
  aiConfig?: AiClientConfig;
  models?: string[];
  interactive?: boolean;
}

export class PromptRunner {
  static async run(options: PromptRunnerOptions): Promise<number> {
    const {
      promptName,
      promptDirs,
      args = {},
      aiConfig,
      models = ["gemini-3-flash-preview", "gemini-3-pro-preview"],
      interactive = false,
    } = options;

    const promptFileName = promptName.endsWith(".md")
      ? promptName
      : `${promptName}.md`;

    let promptFile: string | undefined;
    for (const dir of promptDirs) {
      const candidate = path.join(dir, promptFileName);
      if (existsSync(candidate)) {
        promptFile = candidate;
        break;
      }
    }

    if (!promptFile) {
      console.error(
        `Prompt file '${promptFileName}' not found in any of the search directories:\n` +
          promptDirs.map((d) => `  - ${d}`).join("\n"),
      );
      return 1;
    }

    // Nunjucks Environment Options
    const env = new nunjucks.Environment(
      new nunjucks.FileSystemLoader(promptDirs),
      {
        autoescape: false,
        trimBlocks: true,
        lstripBlocks: true,
      },
    );

    const asyncResolvers = new Map<string, Promise<string>>();
    let resolverId = 0;

    env.addGlobal("context", (targetPath: string) => {
      const id = `__NEXICAL_ASYNC_CONTEXT_${resolverId++}__`;
      const promise = (async () => {
        try {
          if (!existsSync(targetPath)) {
            return `[Path not found: ${targetPath}]`;
          }

          const stats = statSync(targetPath);
          if (stats.isFile()) {
            const content = await fs.readFile(targetPath, "utf-8");
            return `<CODEBASE_CONTEXT path="${targetPath}">\n${content}\n</CODEBASE_CONTEXT>`;
          }

          const tempOutputFile = path.join(
            os.tmpdir(),
            `repomix-output-${Date.now()}-${Math.random().toString(36).substring(7)}.xml`,
          );

          await pack(
            [targetPath],
            {
              input: { maxFileSize: 1024 * 1024 * 10 },
              output: {
                filePath: tempOutputFile,
                style: "xml",
                showLineNumbers: false,
                fileSummary: false,
                directoryStructure: false,
                removeComments: false,
                removeEmptyLines: false,
                includeEmptyDirectories: false,
                topFilesLength: 5,
                parsableStyle: false,
                files: true,
                compress: false,
                truncateBase64: true,
                copyToClipboard: false,
                includeDiffs: false,
                includeLogs: false,
                includeLogsCount: 0,
                gitSortByChanges: false,
                includeFullDirectoryStructure: false,
              },
              ignore: {
                useGitignore: true,
                useDotIgnore: true,
                useDefaultPatterns: true,
                customPatterns: ["**/node_modules", "**/dist"],
              },
              include: [],
              security: { enableSecurityCheck: false },
              tokenCount: { encoding: "o200k_base" },
              cwd: targetPath,
            } as unknown as Parameters<typeof pack>[1],
            undefined,
            undefined,
            undefined,
            { skillName: "temp" },
          );

          const output = await fs.readFile(tempOutputFile, "utf-8");
          try {
            await fs.unlink(tempOutputFile);
          } catch {
            /* ignore */
          }
          return `<CODEBASE_CONTEXT path="${targetPath}">\n${output}\n</CODEBASE_CONTEXT>`;
        } catch (error) {
          console.error(
            `[Context] Error generating context for ${targetPath}: ${error}`,
          );
          return `[Error generating context for ${targetPath}]`;
        }
      })();
      asyncResolvers.set(id, promise);
      return id;
    });

    env.addGlobal("read", (relativePath: string | string[]) => {
      const id = `__NEXICAL_ASYNC_READ_${resolverId++}__`;
      const cwdStr = process.cwd();
      const promise = (async () => {
        try {
          if (Array.isArray(relativePath)) {
            const contents = await Promise.all(
              relativePath.map(async (p) => {
                const resolvedPath = path.resolve(cwdStr, p);
                if (!existsSync(resolvedPath)) {
                  return `[File not found: ${resolvedPath}]`;
                }
                return await fs.readFile(resolvedPath, "utf-8");
              }),
            );
            return contents.join("\n\n");
          } else if (
            typeof relativePath === "string" &&
            relativePath.includes(",")
          ) {
            const contents = await Promise.all(
              relativePath.split(",").map(async (p) => {
                const resolvedPath = path.resolve(cwdStr, p.trim());
                if (!existsSync(resolvedPath)) {
                  return `[File not found: ${resolvedPath}]`;
                }
                return await fs.readFile(resolvedPath, "utf-8");
              }),
            );
            return contents.join("\n\n");
          }

          const resolvedPath = path.resolve(cwdStr, relativePath as string);
          if (!existsSync(resolvedPath)) {
            return `[File not found: ${resolvedPath}]`;
          }
          return await fs.readFile(resolvedPath, "utf-8");
        } catch {
          console.error(`[Read] Error reading file: ${relativePath}`);
          return `[Error reading file ${relativePath}]`;
        }
      })();
      asyncResolvers.set(id, promise);
      return id;
    });

    env.addGlobal("read_glob", (pattern: string) => {
      const id = `__NEXICAL_ASYNC_READ_GLOB_${resolverId++}__`;
      const promise = (async () => {
        try {
          const files = globSync(pattern, {
            cwd: process.cwd(),
            absolute: true,
          });
          if (files.length === 0)
            return `[No files found for pattern: ${pattern}]`;

          const contents = await Promise.all(
            files.map(async (file) => {
              try {
                const content = await fs.readFile(file, "utf-8");
                const relPath = path.relative(process.cwd(), file);
                return `<file name="${relPath}">\n${content}\n</file>`;
              } catch {
                return `[Error reading file ${file}]`;
              }
            }),
          );
          return contents.join("\n");
        } catch (error) {
          console.error(`[ReadGlob] Error with pattern: ${pattern}`, error);
          return `[Error processing glob: ${pattern}]`;
        }
      })();
      asyncResolvers.set(id, promise);
      return id;
    });

    env.addGlobal("read_specs", (pattern: string) => {
      return env.getGlobal("read_glob")(pattern);
    });

    env.addGlobal("compressed_map", (targetPath: string) => {
      const id = `__NEXICAL_ASYNC_COMPRESSED_MAP_${resolverId++}__`;
      const promise = (async () => {
        try {
          const tempOutputFile = path.join(
            os.tmpdir(),
            `repomix-output-${Date.now()}-${Math.random().toString(36).substring(7)}.xml`,
          );

          await pack(
            [targetPath],
            {
              input: { maxFileSize: 1024 * 1024 * 50 },
              output: {
                filePath: tempOutputFile,
                style: "xml",
                showLineNumbers: false,
                fileSummary: false,
                directoryStructure: false,
                removeComments: false,
                removeEmptyLines: false,
                includeEmptyDirectories: false,
                topFilesLength: 5,
                parsableStyle: false,
                files: true,
                compress: false,
                truncateBase64: true,
                copyToClipboard: false,
                includeDiffs: false,
                includeLogs: false,
                includeLogsCount: 0,
                gitSortByChanges: false,
                includeFullDirectoryStructure: false,
              },
              ignore: {
                useGitignore: true,
                useDotIgnore: true,
                useDefaultPatterns: true,
                customPatterns: [
                  "**/node_modules",
                  "**/dist",
                  "**/*.spec.ts",
                  "**/*.test.ts",
                  "**/coverage",
                  "**/.git",
                ],
              },
              include: [],
              security: { enableSecurityCheck: false },
              tokenCount: { encoding: "o200k_base" },
              cwd: targetPath,
            } as unknown as Parameters<typeof pack>[1],
            undefined,
            undefined,
            undefined,
            { skillName: "temp" },
          );

          const output = await fs.readFile(tempOutputFile, "utf-8");
          try {
            await fs.unlink(tempOutputFile);
          } catch {
            /* ignore */
          }
          return `<COMPRESSED_MAP path="${targetPath}">\n${output}\n</COMPRESSED_MAP>`;
        } catch (error) {
          console.error(
            `[Context] Error generating map for ${targetPath}: ${error}`,
          );
          return `[Error generating map for ${targetPath}]`;
        }
      })();
      asyncResolvers.set(id, promise);
      return id;
    });

    let templateContent: string;
    try {
      templateContent = await fs.readFile(promptFile, "utf-8");
    } catch (error) {
      console.error(
        `Error reading prompt file: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }

    let renderedPrompt: string;
    try {
      renderedPrompt = env.renderString(templateContent, { ...args });
    } catch (e) {
      console.error(`Template render error: ${e}`);
      return 1;
    }

    // Resolve placeholders
    for (const [id, promise] of asyncResolvers.entries()) {
      try {
        const resolvedValue = await promise;
        renderedPrompt = renderedPrompt.replace(id, resolvedValue);
      } catch (e) {
        console.error(`[Render] Failed to resolve async variable ${id}: ${e}`);
        renderedPrompt = renderedPrompt.replace(id, `[Error resolving ${id}]`);
      }
    }

    const tempFile = path.join(os.tmpdir(), `.temp_prompt_${Date.now()}.md`);
    await fs.writeFile(tempFile, renderedPrompt, "utf-8");

    let currentPrompt = renderedPrompt;
    let finalCode = 0;

    const aiClient = AiClientFactory.create(aiConfig);

    while (true) {
      let success = false;
      let lastOutput = "";

      for (const model of models) {
        const result = await aiClient.run(model, currentPrompt);

        if (result.code === 0) {
          success = true;
          lastOutput = result.output;
          break;
        }

        if (result.shouldRetry) {
          continue;
        } else {
          finalCode = result.code;
          break;
        }
      }

      if (!success) {
        if (finalCode === 0) finalCode = 1;
        break;
      }

      if (!interactive) {
        break;
      }

      currentPrompt += `\n${lastOutput}`;

      const answer = await this.askUser();

      if (["exit", "quit"].includes(answer.trim().toLowerCase())) {
        break;
      }
      currentPrompt += `\nUser: ${answer}\n`;
    }

    try {
      if (existsSync(tempFile)) {
        await fs.unlink(tempFile);
      }
    } catch {
      // ignore
    }

    return finalCode;
  }

  private static askUser(): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise<string>((resolve) => {
      console.info('\n(Type "exit" or "quit" to end the session)');
      rl.question("> ", (ans) => {
        rl.close();
        resolve(ans);
      });
    });
  }
}
