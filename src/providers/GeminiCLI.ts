import { spawn } from 'node:child_process';
import chalk from 'chalk';
import { AiClient, AiClientConfig, AiClientResult } from '../types.js';

export class GeminiCLI implements AiClient {
    private commandTemplate: string;

    constructor(config: AiClientConfig) {
        this.commandTemplate = config.commandTemplate || 'gemini --yolo -p "" --model {model}';
    }

    run(model: string, input: string): Promise<AiClientResult> {
        return new Promise((resolve) => {
            const command = this.commandTemplate.replace('{model}', model);
            const start = Date.now();

            const child = spawn(command, {
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            let stdoutData = '';
            let stderrData = '';

            child.stdout?.on('data', (data) => {
                const chunk = data.toString();
                process.stdout.write(chalk.yellow(chunk));
                stdoutData += chunk;
            });

            child.stderr?.on('data', (data) => {
                const chunk = data.toString();
                stderrData += chunk;
            });

            child.stdin.write(input);
            child.stdin.end();

            child.on('close', (code) => {
                const duration = Date.now() - start;
                const exitCode = code ?? 1;
                const isExhausted =
                    stderrData.includes('429') ||
                    stderrData.includes('exhausted your capacity') ||
                    stderrData.includes('ResourceExhausted');

                if (exitCode !== 0 && isExhausted) {
                    console.warn(`[Agent] Model ${model} exhausted (429). Duration: ${duration}ms`);
                    resolve({ code: exitCode, shouldRetry: true, output: stdoutData });
                } else {
                    if (exitCode !== 0 && stderrData) {
                        process.stderr.write(stderrData);
                    }
                    resolve({ code: exitCode, shouldRetry: false, output: stdoutData });
                }
            });

            child.on('error', (err) => {
                console.error(
                    `[Agent] Failed to spawn Gemini (${model}): ${err instanceof Error ? err.message : String(err)}`,
                );
                resolve({ code: 1, shouldRetry: false, output: '' });
            });
        });
    }
}
