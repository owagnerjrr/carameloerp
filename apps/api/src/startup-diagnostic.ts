/** Pick useful error fields explicitly; never serialize the driver/config object. */
export function startupDiagnostic(
  error: unknown,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const secrets = Object.entries(environment)
    .filter(
      ([key, value]) =>
        value &&
        /PASSWORD|SECRET|TOKEN|PRIVATE_KEY|DATABASE_URL|CREDENTIAL/i.test(key),
    )
    .flatMap(([, value]) => [value!, encodeURIComponent(value!)])
    .sort((a, b) => b.length - a.length);
  function clean(value: unknown) {
    if (typeof value !== "string") return undefined;
    let text = value;
    for (const secret of secrets) text = text.replaceAll(secret, "[REDACTED]");
    return text
      .replace(
        /\b(?:postgres(?:ql)?|https?):\/\/[^\s"'<>]+/gi,
        "[REDACTED_URL]",
      )
      .replace(
        /(\b(?:password|pwd|token|secret|authorization)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi,
        "$1[REDACTED]",
      )
      .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
      .replace(
        /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
        "[REDACTED_KEY]",
      );
  }
  interface Diagnostic {
    name?: string;
    code?: string;
    message?: string;
    stack?: string;
    cause?: Diagnostic;
    errors?: Diagnostic[];
  }
  function visit(value: unknown, depth: number): Diagnostic {
    if (!value || typeof value !== "object")
      return { message: clean(String(value)) };
    const e = value as {
      name?: unknown;
      code?: unknown;
      message?: unknown;
      stack?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    return {
      name: clean(e.name),
      code: clean(e.code),
      message: clean(e.message),
      stack: clean(e.stack),
      ...(depth < 3 && e.cause ? { cause: visit(e.cause, depth + 1) } : {}),
      ...(depth < 3 && Array.isArray(e.errors)
        ? { errors: e.errors.slice(0, 5).map((v) => visit(v, depth + 1)) }
        : {}),
    };
  }
  return visit(error, 0);
}
