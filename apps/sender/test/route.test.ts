import { describe, expect, it } from "vitest";
import { parseRoute, routeHref } from "../src/hooks/useRoute.js";

describe("routes", () => {
  it("review is a view under pay and round-trips", () => {
    expect(parseRoute("#/pay/review")).toEqual({ page: "pay", view: "review" });
    expect(parseRoute("#/pay")).toEqual({ page: "pay" });
    expect(routeHref({ page: "pay", view: "review" })).toBe("#/pay/review");
    expect(routeHref({ page: "pay" })).toBe("#/pay");
    expect(parseRoute(routeHref({ page: "run", id: "a b" }))).toEqual({ page: "run", id: "a b" });
  });
});
