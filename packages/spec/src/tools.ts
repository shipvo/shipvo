import { isObject } from "./types.js";

/** One MCP tool for one spec action. Plain data, sorted by `name`. */
export interface SpecTool {
  /** Stable tool name. Equal to the action name unless it collides (see `ToolsFromSpecOptions.reserved`). */
  name: string;
  /** The action name in the spec. */
  action: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Error shapes a caller can get back. */
  errors: { code: string; description: string }[];
  /** Same meaning as `needsApproval` in `@shipvo/mcp-tools`: true when the action reaches outside the app. */
  needsApproval: boolean;
}

export interface ToolsFromSpecOptions {
  /** Names already taken in the shared registry. A colliding action gets the prefix `app_`, then `_2`, `_3`... */
  reserved?: Iterable<string>;
}

const MAX_NAME = 64;

const ERRORS = [
  { code: "invalid_input", description: "The input does not match the input schema. The message names the field." },
  { code: "action_failed", description: "A step of the action failed. Nothing after the failing step ran." },
];

function fieldSchema(f: Record<string, unknown>): Record<string, unknown> {
  let s: Record<string, unknown>;
  switch (f.type) {
    case "number":
    case "money":
      s = { type: "number" };
      break;
    case "bool":
      s = { type: "boolean" };
      break;
    case "date":
      s = { type: "string", format: "date" };
      break;
    case "datetime":
      s = { type: "string", format: "date-time" };
      break;
    case "enum":
      s = { type: "string", enum: Array.isArray(f.options) ? [...f.options] : [] };
      break;
    default: // text, image, file, ref
      s = { type: "string" };
  }
  if (f.default !== undefined) s.default = f.default;
  return s;
}

/** Tool definitions for every action in a spec, derived from each action's declared `input`. The spec should already pass `validate`. */
export function toolsFromSpec(spec: unknown, options: ToolsFromSpecOptions = {}): SpecTool[] {
  const actions = isObject(spec) && isObject(spec.actions) ? spec.actions : {};
  const taken = new Set(options.reserved ?? []);
  const out: SpecTool[] = [];
  for (const action of Object.keys(actions).sort()) {
    const a = actions[action];
    if (!isObject(a)) continue;
    let name = action;
    if (taken.has(name)) name = `app_${action}`.slice(0, MAX_NAME);
    for (let n = 2; taken.has(name); n++) {
      const suffix = `_${n}`;
      name = `app_${action}`.slice(0, MAX_NAME - suffix.length) + suffix;
    }
    taken.add(name);

    const input = isObject(a.input) ? a.input : {};
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const key of Object.keys(input).sort()) {
      const f = input[key];
      if (!isObject(f)) continue;
      properties[key] = fieldSchema(f);
      if (f.default === undefined) required.push(key);
    }
    const inputSchema: Record<string, unknown> = { type: "object", properties, additionalProperties: false };
    if (required.length) inputSchema.required = required;

    out.push({
      name,
      action,
      description: typeof a.description === "string" ? a.description : `Run the ${action} action.`,
      inputSchema,
      errors: ERRORS.map((e) => ({ ...e })),
      needsApproval: a.effect === "external",
    });
  }
  return out.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
}
