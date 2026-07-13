import { describe, expect, it } from "vitest";
import { safeEqual } from "./http.js";

describe("safeEqual", () => {
  it("true si son idénticos", () => {
    expect(safeEqual("mismo-token-123", "mismo-token-123")).toBe(true);
  });

  it("false si difieren, incluso en un solo carácter", () => {
    expect(safeEqual("mismo-token-123", "mismo-token-124")).toBe(false);
  });

  it("false si tienen distinta longitud (sin tirar excepción)", () => {
    expect(safeEqual("corto", "un-token-mucho-mas-largo")).toBe(false);
  });

  it("false con string vacío contra un token real", () => {
    expect(safeEqual("", "token-real")).toBe(false);
  });
});
