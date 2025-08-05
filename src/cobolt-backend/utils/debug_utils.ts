import { z, ZodTypeAny } from "zod";

// Helper function to visuzlize the shape of a constructed zod object
export function zodSchemaToString(schema: ZodTypeAny): string {
  // Helper for value formatting
  const valStr: any = (v: any) => typeof v === "string" ? `"${v}"` : Array.isArray(v) ? `[${v.map(valStr).join(", ")}]` : String(v);

  // Main logic per type
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const fields = Object.entries(shape).map(([k, v]) => {
      const propStr = zodSchemaToString(v as ZodTypeAny);
      return `${k}: ${propStr}`;
    });
    return `z.object({\n  ${fields.join(",\n  ")}\n})`;
  }
  if (schema instanceof z.ZodString) {
    return "z.string()";
  }
  if (schema instanceof z.ZodNumber) {
    let s = "z.number()";
    if ((schema as any)._def.checks?.some((c: any) => c.kind === "int")) s += ".int()";
    return s;
  }
  if (schema instanceof z.ZodBoolean) {
    return "z.boolean()";
  }
  if (schema instanceof z.ZodArray) {
    return `z.array(${zodSchemaToString(schema.element)})`;
  }
  if (schema instanceof z.ZodDefault) {
    const inner = zodSchemaToString(schema._def.innerType);
    return `${inner}.default(${valStr(schema._def.defaultValue())})`;
  }
  if (schema instanceof z.ZodOptional) {
    const inner = zodSchemaToString(schema._def.innerType);
    return `${inner}.optional()`;
  }
  if (schema instanceof z.ZodEnum) {
    return `z.enum(${valStr(schema._def.values)})`;
  }
  if (schema instanceof z.ZodUnion) {
    return `z.union([${schema._def.options.map(zodSchemaToString).join(", ")}])`;
  }
  if (schema instanceof z.ZodLiteral) {
    return `z.literal(${valStr(schema._def.value)})`;
  }
  if (schema instanceof z.ZodNull) {
    return "z.null()";
  }
  // Add further cases as desired!

  return "z.any()";
}