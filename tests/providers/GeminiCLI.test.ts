import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiCLI } from '../../src/providers/GeminiCLI.js';
import { spawn } from 'node:child_process';

vi.mock('node:child_process', () => ({
    spawn: vi.fn(),
}));

describe('GeminiCLI', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        // Prevent stdout/stderr intercepts from breaking the test output
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    it('should run a prompt and succeed', async () => {
        const mockChild = {
            stdout: { on: vi.fn((event, cb) => cb('mock response')) },
            stderr: { on: vi.fn() },
            stdin: { write: vi.fn(), end: vi.fn() },
            on: vi.fn((event, callback) => {
                if (event === 'close') callback(0);
            }),
        };
        vi.mocked(spawn).mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

        const client = new GeminiCLI({});
        const result = await client.run('gemini-3-pro-preview', 'Hello World');

        expect(spawn).toHaveBeenCalledWith(
            expect.stringContaining('gemini --yolo -p "" --model'),
            expect.any(Object),
        );
        expect(result.code).toBe(0);
        expect(result.shouldRetry).toBe(false);
        expect(result.output).toBe('mock response');
    });

    it('should return retry status on 429 ResourceExhausted', async () => {
        const mockChild = {
            stdout: { on: vi.fn() },
            stderr: {
                on: vi.fn((event, cb) => {
                    if (event === 'data') cb('Error: ResourceExhausted (429)');
                }),
            },
            stdin: { write: vi.fn(), end: vi.fn() },
            on: vi.fn((event, callback) => {
                if (event === 'close') callback(1);
            }),
        };
        vi.mocked(spawn).mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

        const client = new GeminiCLI({});
        const result = await client.run('gemini-3-pro-preview', 'Hello World');

        expect(result.code).toBe(1);
        expect(result.shouldRetry).toBe(true);
        expect(result.output).toBe('');
    });

    it('should return failure without retry on other errors', async () => {
        const mockChild = {
            stdout: { on: vi.fn() },
            stderr: {
                on: vi.fn((event, cb) => {
                    if (event === 'data') cb('Other fatal model error');
                }),
            },
            stdin: { write: vi.fn(), end: vi.fn() },
            on: vi.fn((event, callback) => {
                if (event === 'close') callback(2);
            }),
        };
        vi.mocked(spawn).mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

        const client = new GeminiCLI({});
        const result = await client.run('gemini-3-pro-preview', 'Hello World');

        expect(result.code).toBe(2);
        expect(result.shouldRetry).toBe(false);
    });

    it('should catch spawn errors', async () => {
        const mockChild = {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            stdin: { write: vi.fn(), end: vi.fn() },
            on: vi.fn((event, callback) => {
                if (event === 'error') callback(new Error('Spawn failed'));
            }),
        };
        vi.mocked(spawn).mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

        const client = new GeminiCLI({});
        const result = await client.run('gemini-3-pro-preview', 'Hello World');

        expect(result.code).toBe(1);
        expect(result.shouldRetry).toBe(false);
        expect(result.output).toBe('');
    });

    it('should use a custom command template', async () => {
        const mockChild = {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            stdin: { write: vi.fn(), end: vi.fn() },
            on: vi.fn((event, callback) => {
                if (event === 'close') callback(0);
            }),
        };
        vi.mocked(spawn).mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

        const client = new GeminiCLI({ commandTemplate: 'echo {model}' });
        await client.run('gemini-3-pro-preview', 'Hello World');

        expect(spawn).toHaveBeenCalledWith('echo gemini-3-pro-preview', expect.any(Object));
    });
});
