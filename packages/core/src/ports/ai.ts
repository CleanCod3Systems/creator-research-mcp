export interface AICompletionRequest {
  system: string;
  prompt: string;
  /** Si se pasa, la respuesta debe validar contra este JSON Schema. */
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
}

export interface AIResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export interface AIEngine {
  readonly name: string;
  readonly model: string;
  complete(req: AICompletionRequest): Promise<AIResult>;
  /** 0 para motores locales. */
  costEstimateUsd(tokensIn: number, tokensOut: number): number;
}
