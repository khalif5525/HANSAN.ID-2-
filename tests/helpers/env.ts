/**
 * Test-only helper for temporarily overriding process.env.NODE_ENV.
 *
 * @types/node types NODE_ENV as a readonly literal, so a direct assignment
 * (`process.env.NODE_ENV = "production"`) fails typecheck with TS2540.
 * Every write is routed through a writable alias instead; getConfig() reads
 * process.env live, so these overrides take effect immediately.
 */
export function setNodeEnv(value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

/** Generic env setter for OTHER read-only-typed keys (e.g. SESSION_SECRET). */
export function setEnv(name: string, value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[name];
  else env[name] = value;
}

/** Read the current raw value of an env key. */
export function getEnv(name: string): string | undefined {
  return (process.env as Record<string, string | undefined>)[name];
}

