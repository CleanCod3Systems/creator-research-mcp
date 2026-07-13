import { describe, expect, it, vi } from "vitest";
import { isTransientHttpError, withRetry } from "./retry.js";

describe("withRetry", () => {
  it("devuelve el resultado si la primera llamada funciona (sin reintentos)", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn, { baseDelayMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("reintenta hasta el límite y después propaga el error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("HTTP 503"));
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow("HTTP 503");
    expect(fn).toHaveBeenCalledTimes(3); // intento inicial + 2 reintentos
  });

  it("se recupera si falla una vez y la segunda funciona", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 429"))
      .mockResolvedValueOnce("recuperado");
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).resolves.toBe("recuperado");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("no reintenta si isRetryable dice que no (ej. error de auth)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("401 unauthorized"));
    await expect(
      withRetry(fn, { retries: 3, baseDelayMs: 1, isRetryable: isTransientHttpError }),
    ).rejects.toThrow("401");
    expect(fn).toHaveBeenCalledTimes(1); // sin reintentos, falla rápido
  });
});

describe("isTransientHttpError", () => {
  it.each([
    ["Ollama http://x respondió 429: too many requests", true],
    ["YouTube HTTP 500 al pedir la página", true],
    ["fetch failed", true],
    ["Instagram exige autenticación para este contenido", false],
    ["HTTP 404 al obtener https://x", false],
    ["No es una URL de tweet", false],
  ])("%s → %s", (msg, expected) => {
    expect(isTransientHttpError(new Error(msg))).toBe(expected);
  });
});
