import { describe, expect, it } from "vitest";

import { validateEnv } from "../src/config/env.validation.js";

const base = {
  DB_HOST: "localhost",
  DB_PORT: "5432",
  DB_NAME: "zoja",
  DB_USER: "postgres",
  DB_PASSWORD: "local-only",
};

describe("validateEnv", () => {
  it("konwertuje typy i uzupełnia wartości domyślne", () => {
    const env = validateEnv({ ...base });

    expect(env.DB_PORT).toBe(5432);
    expect(env.DB_SSL).toBe(false);
    expect(env.DB_POOL_MAX).toBe(2);
    expect(env.NODE_ENV).toBe("development");
  });

  it('traktuje "false" jako false, a nie jako niepusty string', () => {
    expect(validateEnv({ ...base, DB_SSL: "false" }).DB_SSL).toBe(false);
    expect(validateEnv({ ...base, DB_SSL: "true" }).DB_SSL).toBe(true);
  });

  it("wywala się przy braku wymaganej zmiennej", () => {
    const { DB_PASSWORD: _omitted, ...withoutPassword } = base;
    expect(() => validateEnv(withoutPassword)).toThrow(/DB_PASSWORD/);
  });

  it("nie umieszcza wartości zmiennych w komunikacie błędu", () => {
    const raised = (() => {
      try {
        validateEnv({ ...base, DB_HOST: "" });
        return null;
      } catch (error) {
        return error as Error;
      }
    })();

    expect(raised).not.toBeNull();
    expect(raised?.message).toContain("DB_HOST");
    expect(raised?.message).not.toContain("local-only");
  });
});
