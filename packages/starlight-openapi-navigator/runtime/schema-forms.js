const SUPPORTABLE_PRIMITIVE_TYPES = new Set(['string', 'number', 'integer', 'boolean']);

export function createSchemaFormUtils(currentSpec) {
  const schemaDefinitionMap = buildSchemaDefinitionMap(currentSpec);

  function deepClone(value) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return undefined;
    }
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function decodeRefName(pointer) {
    const match = typeof pointer === 'string' ? pointer.match(/#\/components\/schemas\/(.+)$/) : null;
    if (!match) return undefined;
    return match[1]?.replace(/~1/g, '/').replace(/~0/g, '~');
  }

  function getSchemaFromRef(ref) {
    const name = decodeRefName(ref);
    if (!name) return undefined;
    return schemaDefinitionMap.get(name);
  }

  function mergeSchemaObjects(base = {}, override = {}) {
    const result = { ...deepClone(base), ...deepClone(override) };
    const baseProps = isPlainObject(base.properties) ? base.properties : {};
    const overrideProps = isPlainObject(override.properties) ? override.properties : {};
    if (Object.keys(baseProps).length || Object.keys(overrideProps).length) {
      result.properties = { ...deepClone(baseProps), ...deepClone(overrideProps) };
    }
    const baseRequired = Array.isArray(base.required) ? base.required : [];
    const overrideRequired = Array.isArray(override.required) ? override.required : [];
    if (baseRequired.length || overrideRequired.length) {
      result.required = Array.from(new Set([...baseRequired, ...overrideRequired]));
    }
    if (base.allOf || override.allOf) delete result.allOf;
    return result;
  }

  function resolveSchemaObject(schema, seen = new Set()) {
    if (!isPlainObject(schema)) return undefined;

    let workingSchema = deepClone(schema) || {};

    if (workingSchema.$ref) {
      const ref = workingSchema.$ref;
      if (!seen.has(ref)) {
        seen.add(ref);
        const referenced = resolveSchemaObject(getSchemaFromRef(ref), new Set(seen)) || {};
        const localWithoutRef = { ...workingSchema };
        delete localWithoutRef.$ref;
        workingSchema = mergeSchemaObjects(referenced, localWithoutRef);
      } else {
        const clone = { ...workingSchema };
        delete clone.$ref;
        workingSchema = clone;
      }
    }

    if (Array.isArray(workingSchema.allOf)) {
      workingSchema.allOf.forEach((entry) => {
        const resolved = resolveSchemaObject(entry, new Set(seen));
        if (resolved) {
          workingSchema = mergeSchemaObjects(workingSchema, resolved);
        }
      });
      delete workingSchema.allOf;
    }

    if (isPlainObject(workingSchema.properties)) {
      const resolvedProps = {};
      Object.entries(workingSchema.properties).forEach(([key, value]) => {
        resolvedProps[key] = resolveSchemaObject(value, new Set(seen)) || {};
      });
      workingSchema.properties = resolvedProps;
    }

    if (isPlainObject(workingSchema.items)) {
      workingSchema.items = resolveSchemaObject(workingSchema.items, new Set(seen)) || {};
    }

    if (isPlainObject(workingSchema.additionalProperties)) {
      workingSchema.additionalProperties = resolveSchemaObject(
        workingSchema.additionalProperties,
        new Set(seen)
      ) || {};
    }

    if (!workingSchema.type) {
      if (workingSchema.properties) workingSchema.type = 'object';
      else if (workingSchema.items) workingSchema.type = 'array';
    }

    return workingSchema;
  }

  function inferSchemaType(schema) {
    if (!schema || typeof schema !== 'object') return '';
    if (Array.isArray(schema.type)) return schema.type[0];
    if (schema.type) return schema.type;
    if (schema.properties) return 'object';
    if (schema.items) return 'array';
    if (Array.isArray(schema.enum) && schema.enum.length) {
      const sample = schema.enum[0];
      if (typeof sample === 'number') return Number.isInteger(sample) ? 'integer' : 'number';
      if (typeof sample === 'boolean') return 'boolean';
      if (typeof sample === 'string') return 'string';
    }
    return '';
  }

  function buildSchemaFormTree(schema) {
    const resolved = resolveSchemaObject(schema);
    if (!resolved || inferSchemaType(resolved) !== 'object') return null;
    return createSchemaNode({
      name: null,
      schema: resolved,
      path: [],
      required: false,
    });
  }

  function createSchemaNode({ name, schema, path, required }) {
    if (!schema || typeof schema !== 'object') return null;

    const type = inferSchemaType(schema);

    if (schema.oneOf || schema.anyOf || schema.not) {
      return {
        kind: 'unsupported',
        name,
        path,
        required,
        message: 'Polymorphic schemas (oneOf/anyOf/not) are not yet supported in form mode.',
      };
    }

    if (schema.additionalProperties) {
      return {
        kind: 'unsupported',
        name,
        path,
        required,
        message: 'Dynamic key objects (additionalProperties) are not supported. Use raw JSON mode.',
      };
    }

    if (type === 'object') {
      const properties = isPlainObject(schema.properties) ? schema.properties : {};
      const requiredSet = new Set(Array.isArray(schema.required) ? schema.required : []);
      const children = Object.entries(properties)
        .map(([propName, propSchema]) =>
          createSchemaNode({
            name: propName,
            schema: propSchema,
            path: [...path, propName],
            required: requiredSet.has(propName),
          })
        )
        .filter(Boolean);

      return {
        kind: 'object',
        name,
        path,
        required,
        description: typeof schema.description === 'string' ? schema.description : undefined,
        children,
      };
    }

    if (type === 'array') {
      const itemSchema = schema.items ? resolveSchemaObject(schema.items) : undefined;
      const itemType = inferSchemaType(itemSchema);
      if (SUPPORTABLE_PRIMITIVE_TYPES.has(itemType)) {
        return {
          kind: 'array',
          name,
          path,
          required,
          description: typeof schema.description === 'string' ? schema.description : undefined,
          itemType,
          enum: Array.isArray(itemSchema?.enum) ? itemSchema.enum : undefined,
          example: itemSchema?.example ?? schema.example,
        };
      }
      return {
        kind: 'unsupported',
        name,
        path,
        required,
        message:
          'Only arrays of primitive values are supported in form mode. Use raw JSON to set complex arrays.',
      };
    }

    if (SUPPORTABLE_PRIMITIVE_TYPES.has(type)) {
      return {
        kind: 'primitive',
        type,
        name,
        path,
        required,
        description: typeof schema.description === 'string' ? schema.description : undefined,
        format: typeof schema.format === 'string' ? schema.format : undefined,
        enum: Array.isArray(schema.enum) ? schema.enum : undefined,
        default: schema.default,
        example: schema.example,
        pattern: schema.pattern,
        minimum: schema.minimum,
        maximum: schema.maximum,
        minLength: schema.minLength,
        maxLength: schema.maxLength,
      };
    }

    return {
      kind: 'unsupported',
      name,
      path,
      required,
      message: 'This field type is not supported in the generated form. Use raw JSON to edit it.',
    };
  }

  function collectUnsupportedMessages(node, messages = []) {
    if (!node) return messages;
    if (node.kind === 'unsupported' && node.message) {
      messages.push({
        path: node.path.join('.') || node.name || 'field',
        message: node.message,
      });
    }
    if (node.kind === 'object' && Array.isArray(node.children)) {
      node.children.forEach((child) => collectUnsupportedMessages(child, messages));
    }
    return messages;
  }

  function tryParseJsonExample(value) {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }

  function formatExampleValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  }

  function buildRequestBodyFormOptions(operation) {
    const content = operation?.requestBody?.content;
    if (!content || typeof content !== 'object') return [];
    const entries = Object.entries(content).filter(
      ([type]) => typeof type === 'string' && type.length
    );
    if (!entries.length) return [];

    const examplesByType = new Map();
    (operation?.requestBodyExamples || []).forEach((group) => {
      const example = group?.examples?.find((entry) => entry?.value !== undefined)?.value;
      if (example !== undefined) examplesByType.set(group.contentType, example);
    });

    return entries.map(([contentType, media]) => {
      const resolvedSchema = media?.schema ? resolveSchemaObject(media.schema) : undefined;
      const schemaType = inferSchemaType(resolvedSchema) || media?.schema?.type || '';
      const formTree = resolvedSchema ? buildSchemaFormTree(resolvedSchema) : null;
      const formFields = formTree?.kind === 'object' ? formTree.children || [] : [];
      const supportsForm = Boolean(formFields.find((field) => field?.kind !== 'unsupported'));
      const schemaWarnings = formTree ? collectUnsupportedMessages(formTree) : [];

      const rawExample =
        examplesByType.get(contentType) ??
        media?.example ??
        media?.examples?.default?.value;
      const parsedExample = tryParseJsonExample(rawExample);
      const exampleText =
        parsedExample !== undefined
          ? JSON.stringify(parsedExample, null, 2)
          : formatExampleValue(rawExample);

      return {
        contentType,
        schemaType,
        supportsForm,
        formTree,
        formFields,
        schemaWarnings,
        example: exampleText,
        exampleValue: parsedExample,
        required: Boolean(operation?.requestBody?.required),
      };
    });
  }

  return {
    resolveSchemaObject,
    inferSchemaType,
    buildSchemaFormTree,
    collectUnsupportedMessages,
    tryParseJsonExample,
    formatExampleValue,
    buildRequestBodyFormOptions,
  };
}

export { SUPPORTABLE_PRIMITIVE_TYPES };

function buildSchemaDefinitionMap(currentSpec) {
  const map = new Map();
  const candidateSources = [
    currentSpec?.document?.components?.schemas,
    currentSpec?.components?.schemas,
  ];
  candidateSources.forEach((source) => {
    if (source && typeof source === 'object') {
      Object.entries(source).forEach(([name, schema]) => {
        if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
          map.set(name, schema);
        }
      });
    }
  });
  if (Array.isArray(currentSpec?.schemas)) {
    currentSpec.schemas.forEach((entry) => {
      if (entry && typeof entry.name === 'string' && entry.schema && typeof entry.schema === 'object') {
        map.set(entry.name, entry.schema);
      }
    });
  }
  return map;
}
