import {
  Accordion,
  AccordionItem,
  CodeSnippet,
  InlineLoading,
  InlineNotification,
} from "@carbon/react";
import type { SemanticExample, SemanticPreview } from "../../models";
import type { PreviewState } from "./ExamplesStep";

function PreviewOutcome({
  data,
  example,
}: {
  data: SemanticPreview;
  example: SemanticExample;
}) {
  if (data.error)
    return (
      <InlineNotification
        kind="error"
        title="Evaluation error"
        subtitle={data.error}
        hideCloseButton
      />
    );
  const expected = example.expectedBlocked ? "blocked" : example.expectedLabel;
  const actual = data.blocked
    ? "blocked"
    : data.noMatch
      ? "no_match"
      : data.label;
  const title = data.blocked
    ? "Request blocked by guard"
    : data.noMatch
      ? "No action matched"
      : "Action selected";
  const extra = data.blocked ? " No classification or action ran." : "";
  return (
    <InlineNotification
      kind={expected === actual ? "success" : "warning"}
      title={title}
      subtitle={`Expected: ${expected}. Actual: ${actual}.${extra}`}
      hideCloseButton
    />
  );
}

export function PreviewResult({
  result,
  example,
}: {
  result?: PreviewState;
  example: SemanticExample;
}) {
  if (!result) return null;
  if (result.status === "loading")
    return (
      <div aria-live="polite">
        <InlineLoading description="Evaluating example" />
      </div>
    );
  if (result.status === "error")
    return (
      <div aria-live="polite">
        <InlineNotification
          kind="error"
          title="Preview failed"
          subtitle={result.error}
          hideCloseButton
        />
      </div>
    );
  const data = result.data;
  const diagnostics = {
    ...data.diagnostics,
    ...(data.guard ? { guard: data.guard.diagnostics } : {}),
  };
  return (
    <div aria-live="polite">
      <PreviewOutcome data={data} example={example} />
      {data.guard && <p>Guard result: {String(data.guard.value)}.</p>}
      {data.durationMillis !== undefined && (
        <p>Evaluation time: {data.durationMillis} ms.</p>
      )}
      {Object.keys(diagnostics).length > 0 && (
        <Accordion>
          <AccordionItem title="Available evaluation diagnostics">
            <CodeSnippet type="multi" feedback="Copied">
              {JSON.stringify(diagnostics, null, 2)}
            </CodeSnippet>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}
