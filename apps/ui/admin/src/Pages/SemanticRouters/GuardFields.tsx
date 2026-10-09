import {
  Checkbox,
  InlineNotification,
  Select,
  SelectItem,
  Tile,
} from "@carbon/react";
import type {
  SemanticExpert,
  SemanticFieldError,
  SemanticRouterDefinition,
} from "../../models";
import { guardOperations } from "./expertCatalog";
import { GuardParameters } from "./GuardParameters";

interface GuardFieldsProps {
  definition: SemanticRouterDefinition;
  experts: SemanticExpert[];
  errors: SemanticFieldError[];
  onChange: (definition: SemanticRouterDefinition) => void;
}
export function GuardFields({
  definition,
  experts,
  errors,
  onChange,
}: GuardFieldsProps) {
  const guard = definition.guard;
  const available = experts.filter(
    (expert) => guardOperations(expert).length > 0,
  );
  const expert = experts.find((item) => item.id === guard?.expertId);
  const operations = expert ? guardOperations(expert) : [];
  const operation = operations.find((item) => item.name === guard?.operation);
  const error = (field: string) =>
    errors.find((item) => item.field === field)?.message;
  return (
    <Tile className="semantic-router-fields">
      <Checkbox
        id="semantic-guard-enabled"
        labelText="Check an optional guard before classification"
        checked={Boolean(guard)}
        onChange={(_event, { checked }) =>
          onChange({
            ...definition,
            guard: checked
              ? {
                  expertId: "",
                  operation: "",
                  parameters: {},
                  rejectWhen: true,
                }
              : undefined,
            examples: checked
              ? definition.examples
              : definition.examples?.map((example) => ({
                  ...example,
                  expectedBlocked: false,
                })),
          })
        }
      />
      {guard && (
        <>
          {error("guard.parameters") && (
            <InlineNotification
              kind="error"
              title="Invalid guard parameters"
              subtitle={error("guard.parameters")}
              hideCloseButton
            />
          )}
          {available.length === 0 && (
            <InlineNotification
              kind="info"
              title="No guard experts available"
              subtitle="Add a text-compatible Boolean operation using Manage experts."
              hideCloseButton
            />
          )}
          <Select
            id="guard-expert"
            labelText="Guard expert"
            value={guard.expertId ?? ""}
            invalid={Boolean(error("guard.expertId"))}
            invalidText={error("guard.expertId")}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              const selected = available.find(
                (item) => item.id === event.target.value,
              );
              onChange({
                ...definition,
                guard: {
                  ...guard,
                  expertId: event.target.value,
                  operation: selected ? guardOperations(selected)[0]?.name : "",
                  parameters: {},
                },
              });
            }}
          >
            <SelectItem value="" text="Select a guard expert" />
            {available.map((item) => (
              <SelectItem
                key={item.id}
                value={item.id}
                text={item.name ?? item.id ?? ""}
              />
            ))}
          </Select>
          <Select
            id="guard-operation"
            labelText="Guard operation"
            value={guard.operation ?? ""}
            invalid={Boolean(error("guard.operation"))}
            invalidText={error("guard.operation")}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              onChange({
                ...definition,
                guard: {
                  ...guard,
                  operation: event.target.value,
                  parameters: {},
                },
              })
            }
          >
            <SelectItem value="" text="Select a Boolean operation" />
            {operations.map((item) => (
              <SelectItem
                key={item.name}
                value={item.name}
                text={item.name ?? ""}
              />
            ))}
          </Select>
          {operation?.resultMeaning && <p>{operation.resultMeaning}</p>}
          <Select
            id="guard-reject-when"
            labelText="Reject request when guard returns"
            value={String(guard.rejectWhen ?? true)}
            helperText="True suits threat detection; false suits approval checks. Rejected requests run no classifier or action. Evaluation errors stop processing."
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              onChange({
                ...definition,
                guard: { ...guard, rejectWhen: event.target.value === "true" },
              })
            }
          >
            <SelectItem
              value="true"
              text="True (for example, threat detected)"
            />
            <SelectItem
              value="false"
              text="False (for example, approval denied)"
            />
          </Select>
          {operation && (
            <GuardParameters
              key={`${guard.expertId}:${guard.operation}`}
              schema={operation.parameterSchema ?? {}}
              parameters={guard.parameters ?? {}}
              errors={errors}
              onChange={(parameters) =>
                onChange({ ...definition, guard: { ...guard, parameters } })
              }
            />
          )}
        </>
      )}
    </Tile>
  );
}
