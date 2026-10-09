import type { SemanticExpert } from "../../models";

export function classifierExpert(expert: SemanticExpert): boolean {
  if (!expert.operations?.length) return true;
  return expert.operations.some((operation) => {
    const properties = operation.parameterSchema?.properties;
    return (
      operation.name === "choice" &&
      operation.resultType === "choice" &&
      operation.inputTypes?.includes("text") &&
      properties !== null &&
      typeof properties === "object" &&
      "instructions" in properties &&
      "criteria" in properties
    );
  });
}

export function guardOperations(expert: SemanticExpert) {
  return (expert.operations ?? []).filter(
    (operation) =>
      operation.resultType === "boolean" &&
      operation.inputTypes?.includes("text"),
  );
}

export function expertTemplate(
  kind: "choice" | "injection",
  camelVersion: string,
): SemanticExpert {
  const choice = kind === "choice";
  return {
    id: choice ? "typesafe" : "wolf-defender",
    name: choice ? "TypeSafe AI" : "Wolf Defender",
    bean: choice ? "typesafeExpert" : "guardExpert",
    dependency: `org.apache.camel:camel-${choice ? "typesafe-ai" : "wolf-defender"}:${camelVersion}`,
    supportsConfidence: false,
    operations: [
      {
        name: kind,
        inputTypes: ["text"],
        resultType: choice ? "choice" : "boolean",
        resultMeaning: choice
          ? "Selected criterion label"
          : "True means prompt injection detected",
        parameterSchema: choice
          ? {
              type: "object",
              additionalProperties: false,
              required: ["instructions", "criteria"],
              properties: {
                instructions: { type: "string", minLength: 1 },
                criteria: {
                  type: "object",
                  additionalProperties: { type: "string" },
                },
              },
            }
          : {
              type: "object",
              additionalProperties: false,
              properties: {
                threshold: { type: "number", minimum: 0, maximum: 1 },
                uncertainty: { type: "number", minimum: 0, maximum: 1 },
                uncertaintyPolicy: {
                  type: "string",
                  enum: ["fail", "non-match"],
                },
              },
            },
      },
    ],
  };
}
