import type {
  OpenCodeChronology,
  OpenCodeMessage,
  OpenCodeMessageInfo,
  Part,
  ToolPart,
} from "./opencode";

type RecordValue = Readonly<Record<string, unknown>>;

export class OpenCodeWireError extends Error {
  readonly code = "INVALID_MESSAGE_ENVELOPE";

  constructor(message: string) {
    super(message);
    this.name = "OpenCodeWireError";
  }
}

function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: RecordValue, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new OpenCodeWireError(`${key} must be a non-empty string`);
  }
  return field;
}

function optionalString(value: RecordValue, key: string): string | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== "string") throw new OpenCodeWireError(`${key} must be a string`);
  return field;
}

function chronology(value: unknown): OpenCodeChronology | undefined {
  if (value === undefined) return undefined;
  if (!record(value)) throw new OpenCodeWireError("time must be an object");
  for (const key of ["created", "updated", "completed", "end"]) {
    const field = value[key];
    if (field !== undefined && typeof field !== "number" && typeof field !== "string") {
      throw new OpenCodeWireError(`time.${key} must be a number or string`);
    }
  }
  const field = (key: string): number | string | undefined => {
    const item = value[key];
    return typeof item === "number" || typeof item === "string" ? item : undefined;
  };
  return { created: field("created"), updated: field("updated"), completed: field("completed"), end: field("end") };
}

function messageInfo(value: unknown): OpenCodeMessageInfo {
  if (!record(value)) throw new OpenCodeWireError("message info must be an object");
  return {
    id: requiredString(value, "id"),
    sessionID: requiredString(value, "sessionID"),
    role: requiredString(value, "role"),
    parentID: optionalString(value, "parentID"),
    finish: optionalString(value, "finish"),
    error: value.error,
    time: chronology(value.time),
    createdAt: optionalString(value, "createdAt"),
    updatedAt: optionalString(value, "updatedAt"),
  };
}

function toolPart(value: RecordValue): ToolPart {
  if (!record(value.state)) throw new OpenCodeWireError("tool state must be an object");
  const base = {
    id: requiredString(value, "id"), messageID: requiredString(value, "messageID"),
    sessionID: requiredString(value, "sessionID"), type: "tool" as const,
    callID: requiredString(value, "callID"), tool: requiredString(value, "tool"),
    time: chronology(value.time), createdAt: optionalString(value, "createdAt"),
    updatedAt: optionalString(value, "updatedAt"),
  };
  const title = optionalString(value.state, "title");
  const shared = { title, input: value.state.input, metadata: record(value.state.metadata) ? value.state.metadata : undefined };
  switch (value.state.status) {
    case "pending": return { ...base, state: { status: "pending", ...shared } };
    case "running": return { ...base, state: { status: "running", ...shared } };
    case "completed": return { ...base, state: { status: "completed", ...shared, output: value.state.output } };
    case "error": {
      const error = record(value.state.error)
        ? { name: optionalString(value.state.error, "name"), message: optionalString(value.state.error, "message") }
        : undefined;
      return { ...base, state: { status: "error", ...shared, error, output: value.state.output } };
    }
    default: throw new OpenCodeWireError("tool state status is invalid");
  }
}

function part(value: unknown): Part {
  if (!record(value)) throw new OpenCodeWireError("message part must be an object");
  const type = requiredString(value, "type");
  if (type === "tool") return toolPart(value);
  if (type === "text") {
    return {
      id: requiredString(value, "id"), messageID: requiredString(value, "messageID"),
      sessionID: requiredString(value, "sessionID"), type, text: requiredString(value, "text"),
    };
  }
  return { ...value, type };
}

export function parseSessionMessages(value: unknown): readonly OpenCodeMessage[] {
  if (!Array.isArray(value)) throw new OpenCodeWireError("session messages must be an array");
  return value.map((entry) => {
    if (!record(entry) || !Array.isArray(entry.parts)) {
      throw new OpenCodeWireError("message envelope must contain info and parts");
    }
    return { info: messageInfo(entry.info), parts: entry.parts.map(part) };
  });
}
