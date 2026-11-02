import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";

describe("server configuration", () => {
  it("accepts HTTP/HTTPS origins and normalizes an origin without paths", () => {
    expect(
      readConfig({ WEB_ORIGIN: "https://world.example/director" }).webOrigin,
    ).toBe("https://world.example");
    expect(readConfig({ WEB_ORIGIN: "http://localhost:5173" }).webOrigin).toBe(
      "http://localhost:5173",
    );
  });
  it.each(["file:///tmp/world", "data:text/html,hello", "ftp://world.example"])(
    "rejects unsupported web origin protocol %s before starting",
    (WEB_ORIGIN) =>
      expect(() => readConfig({ WEB_ORIGIN })).toThrow(
        "WEB_ORIGIN must use http or https",
      ),
  );
});
