export interface AiClientResult {
    code: number;
    shouldRetry: boolean;
    output: string;
}

export interface AiClientConfig {
    provider?: string;
    commandTemplate?: string;
    [key: string]: unknown;
}

export interface AiClient {
    run(model: string, input: string): Promise<AiClientResult>;
}
