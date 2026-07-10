export function assertProofMatchesSettlement(input: {
  proof: unknown;
  fixtureId: string;
  seq: string;
  statKey1: number;
  value1?: number;
  statKey2?: number;
  value2?: number;
}) {
  const flattened = flatten(input.proof);
  requireContains(flattened, String(input.fixtureId), "fixture id");
  requireContains(flattened, String(input.seq), "TxLINE sequence");
  requireContains(flattened, String(input.statKey1), "first stat key");
  if (input.value1 !== undefined) {
    requireContains(flattened, String(input.value1), "first stat value");
  }

  if (input.statKey2 !== undefined) {
    requireContains(flattened, String(input.statKey2), "second stat key");
  }
  if (input.value2 !== undefined) {
    requireContains(flattened, String(input.value2), "second stat value");
  }
}

function requireContains(values: Set<string>, expected: string, label: string) {
  if (!values.has(expected)) {
    throw new Error(`TxLINE proof does not contain expected ${label}: ${expected}`);
  }
}

function flatten(value: unknown, out = new Set<string>()) {
  if (value === null || value === undefined) return out;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    out.add(String(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, out);
    return out;
  }
  if (typeof value === "object") {
    for (const nested of Object.values(value)) flatten(nested, out);
  }
  return out;
}
