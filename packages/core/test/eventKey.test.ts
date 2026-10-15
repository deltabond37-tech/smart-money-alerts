import { describe, expect, it } from "vitest";
import { eventKey, normSize } from "../src/eventKey.js";
import { T0, W1 } from "./helpers.js";

describe("eventKey", () => {
  it("is stable across calls, case and float noise", () => {
    const a = eventKey(W1, "ETH", T0, 0, 10);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(eventKey(W1.toUpperCase(), "eth", T0, 0, 10)).toBe(a);
    expect(eventKey(W1, "ETH", T0, 0.1 + 0.2, 10)).toBe(eventKey(W1, "ETH", T0, 0.3, 10));
    expect(eventKey(W1, "ETH", T0, -0, 10)).toBe(a);
  });

  it("changes when any input changes", () => {
    const a = eventKey(W1, "ETH", T0, 0, 10);
    expect(eventKey(W1, "ETH", T0 + 1000, 0, 10)).not.toBe(a);
    expect(eventKey(W1, "ETH", T0, 0, 11)).not.toBe(a);
    expect(eventKey(W1, "BTC", T0, 0, 10)).not.toBe(a);
    expect(eventKey("other", "ETH", T0, 0, 10)).not.toBe(a);
  });

  it("normSize trims trailing zeros", () => {
    expect(normSize(10)).toBe("10");
    expect(normSize(0.5)).toBe("0.5");
    expect(normSize(0)).toBe("0");
    expect(normSize(-2.25)).toBe("-2.25");
  });
});
