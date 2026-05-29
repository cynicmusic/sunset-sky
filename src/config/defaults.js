// Builds the default param tree from the schema. Verbatim pattern from sunset.

import { schema, sectionOrder } from './paramSchema.js';

function defaultValue(field) {
  if (field.type === 'range') return [...field.default];
  return field.default;
}

function buildDefaults() {
  const out = {};
  for (const section of sectionOrder) {
    out[section] = {};
    const fields = schema[section].fields;
    for (const [key, field] of Object.entries(fields)) {
      out[section][key] = defaultValue(field);
    }
  }
  return out;
}

export const defaultParams = buildDefaults();
