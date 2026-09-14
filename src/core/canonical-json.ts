export class CanonicalJsonError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

function stringifyValue(value: unknown, stack: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new CanonicalJsonError("JSON numbers must be finite");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new CanonicalJsonError(
      "JSON values must not contain functions or undefined",
    );
  }
  if (stack.has(value))
    throw new CanonicalJsonError("JSON value contains a cycle");
  stack.add(value);
  let result: string;
  if (Array.isArray(value)) {
    result = `[${value.map((item) => stringifyValue(item, stack)).join(",")}]`;
  } else {
    const object = value as Record<string, unknown>;
    const entries = Object.keys(object)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${stringifyValue(object[key], stack)}`,
      );
    result = `{${entries.join(",")}}`;
  }
  stack.delete(value);
  return result;
}

export function canonicalStringify(value: unknown): string {
  return stringifyValue(value, new Set<object>());
}

class StrictJsonParser {
  private index = 0;

  public constructor(private readonly input: string) {}

  public parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.input.length) {
      this.fail("trailing data");
    }
    return value;
  }

  private parseValue(): unknown {
    const character = this.input[this.index];
    if (character === '"') return this.parseString();
    if (character === "{") return this.parseObject();
    if (character === "[") return this.parseArray();
    if (this.input.startsWith("true", this.index)) {
      this.index += 4;
      return true;
    }
    if (this.input.startsWith("false", this.index)) {
      this.index += 5;
      return false;
    }
    if (this.input.startsWith("null", this.index)) {
      this.index += 4;
      return null;
    }
    return this.parseNumber();
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.input.length) {
      const character = this.input[this.index];
      if (character === "\\") {
        this.index += 2;
        continue;
      }
      if (character === '"') {
        this.index += 1;
        const raw = this.input.slice(start, this.index);
        try {
          return JSON.parse(raw) as string;
        } catch {
          this.fail("invalid string");
        }
      }
      if (character < " ") this.fail("control character in string");
      this.index += 1;
    }
    this.fail("unterminated string");
  }

  private parseNumber(): number {
    const match = this.input
      .slice(this.index)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) this.fail("invalid value");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.fail("nonfinite number");
    return value;
  }

  private parseArray(): unknown[] {
    this.expect("[");
    const values: unknown[] = [];
    this.skipWhitespace();
    if (this.peek("]")) {
      this.index += 1;
      return values;
    }
    while (true) {
      values.push(this.parseValue());
      this.skipWhitespace();
      if (this.peek("]")) {
        this.index += 1;
        return values;
      }
      this.expect(",");
      this.skipWhitespace();
    }
  }

  private parseObject(): Record<string, unknown> {
    this.expect("{");
    const object = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.peek("}")) {
      this.index += 1;
      return object;
    }
    while (true) {
      this.skipWhitespace();
      if (!this.peek('"')) this.fail("object key must be a string");
      const key = this.parseString();
      if (keys.has(key)) this.fail(`duplicate key: ${key}`);
      keys.add(key);
      this.skipWhitespace();
      this.expect(":");
      this.skipWhitespace();
      object[key] = this.parseValue();
      this.skipWhitespace();
      if (this.peek("}")) {
        this.index += 1;
        return object;
      }
      this.expect(",");
    }
  }

  private expect(expected: string): void {
    if (!this.input.startsWith(expected, this.index)) {
      this.fail(`expected ${expected}`);
    }
    this.index += expected.length;
  }

  private peek(expected: string): boolean {
    return this.input.startsWith(expected, this.index);
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.input[this.index] ?? "")) this.index += 1;
  }

  private fail(message: string): never {
    throw new CanonicalJsonError(`${message} at byte ${this.index}`);
  }
}

export function parseStrictJson(input: string): unknown {
  return new StrictJsonParser(input).parse();
}
