import { useState } from "react";
import { Select, SelectItem, TextArea, TextInput } from "@carbon/react";

interface GuardParametersProps {
  schema: Record<string, unknown>;
  parameters: Record<string, unknown>;
  errors: { field?: string; message?: string }[];
  onChange: (parameters: Record<string, unknown>) => void;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function JsonParameter({
  name,
  value,
  schema,
  error,
  onChange,
}: {
  name: string;
  value: unknown;
  schema: Record<string, unknown>;
  error?: string;
  onChange: (value: unknown) => void;
}) {
  const [text, setText] = useState(
    value === undefined ? "" : JSON.stringify(value, null, 2),
  );
  const [invalid, setInvalid] = useState(false);
  return (
    <TextArea
      id={`guard-param-${name}`}
      labelText={typeof schema.title === "string" ? schema.title : name}
      value={text}
      helperText={
        typeof schema.description === "string"
          ? schema.description
          : "Enter a JSON value."
      }
      invalid={invalid || Boolean(error)}
      invalidText={invalid ? "Enter valid JSON." : error}
      onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setText(event.target.value);
        try {
          const parsed: unknown = event.target.value
            ? JSON.parse(event.target.value)
            : undefined;
          setInvalid(false);
          onChange(parsed);
        } catch {
          setInvalid(true);
          onChange(event.target.value);
        }
      }}
    />
  );
}

export function GuardParameters({
  schema,
  parameters,
  errors,
  onChange,
}: GuardParametersProps) {
  const update = (name: string, value: unknown) => {
    const next = { ...parameters };
    if (value === undefined || value === "") delete next[name];
    else next[name] = value;
    onChange(next);
  };
  const required = Array.isArray(schema.required) ? schema.required : [];
  return Object.entries(record(schema.properties)).map(([name, raw]) => {
    const property = record(raw);
    const error = errors.find(
      (item) => item.field === `guard.parameters.${name}`,
    )?.message;
    const label = `${typeof property.title === "string" ? property.title : name}${required.includes(name) ? " (required)" : ""}`;
    const help =
      typeof property.description === "string" ? property.description : "";
    const value = parameters[name];
    if (property.type === "object" || property.type === "array")
      return (
        <JsonParameter
          key={name}
          name={name}
          value={value}
          schema={property}
          error={error}
          onChange={(next) => update(name, next)}
        />
      );
    if (property.type === "boolean" || Array.isArray(property.enum)) {
      const options: unknown[] =
        property.type === "boolean"
          ? [true, false]
          : (property.enum as unknown[]);
      return (
        <Select
          key={name}
          id={`guard-param-${name}`}
          labelText={label}
          helperText={help}
          value={value === undefined ? "" : String(value)}
          invalid={Boolean(error)}
          invalidText={error}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
            update(
              name,
              options.find((option) => String(option) === event.target.value),
            )
          }
        >
          <SelectItem value="" text="Select a value" />
          {options.map((option) => (
            <SelectItem
              key={String(option)}
              value={String(option)}
              text={String(option)}
            />
          ))}
        </Select>
      );
    }
    const numeric = property.type === "number" || property.type === "integer";
    return (
      <TextInput
        key={name}
        id={`guard-param-${name}`}
        labelText={label}
        helperText={help}
        value={value === undefined ? "" : String(value)}
        type={numeric ? "number" : "text"}
        invalid={Boolean(error)}
        invalidText={error}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
          update(
            name,
            numeric && event.target.value
              ? Number(event.target.value)
              : event.target.value,
          )
        }
      />
    );
  });
}
