import { AiClient, AiClientConfig } from './types.js';
import { GeminiCLI } from './providers/GeminiCLI.js';

export class AiClientFactory {
    static create(config?: AiClientConfig): AiClient {
        const provider = config?.provider || 'gemini-cli';

        if (provider === 'gemini-cli') {
            return new GeminiCLI(config || {});
        }

        throw new Error(`Unsupported AI Client provider: ${provider}`);
    }
}
