import { useState } from "react";
import {
  Checkbox,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  TextArea,
  TextInput,
} from "@carbon/react";
import type { SemanticExpert } from "../../models";
import { expertTemplate } from "./expertCatalog";
import { getErrorMessage } from "../../utils/error";

interface ExpertEditorProps {
  expert: SemanticExpert | null;
  camelVersion: string;
  onSave: (expert: SemanticExpert) => Promise<void>;
  onClose: () => void;
}

export function ExpertEditor({
  expert,
  camelVersion,
  onSave,
  onClose,
}: ExpertEditorProps) {
  const [draft, setDraft] = useState<SemanticExpert>(
    expert ?? expertTemplate("choice", camelVersion),
  );
  const [operations, setOperations] = useState(
    JSON.stringify(draft.operations ?? [], null, 2),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const parsed: unknown = JSON.parse(operations);
      if (
        !Array.isArray(parsed) ||
        !parsed.every(
          (value: unknown) =>
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value),
        )
      )
        throw new Error(
          "Operations must be a JSON array of operation objects.",
        );
      await onSave({
        ...draft,
        operations: parsed as SemanticExpert["operations"],
      });
      onClose();
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      modalHeading={expert ? "Edit expert" : "Add expert"}
      primaryButtonText="Save expert"
      secondaryButtonText="Cancel"
      primaryButtonDisabled={
        busy ||
        !draft.id?.trim() ||
        !draft.name?.trim() ||
        !draft.bean?.trim() ||
        !draft.dependency?.trim()
      }
      onRequestSubmit={() => void save()}
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="semantic-router-fields">
        {!expert && (
          <Select
            id="expert-template"
            labelText="Expert template"
            defaultValue="choice"
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              const template = expertTemplate(
                event.target.value === "injection" ? "injection" : "choice",
                camelVersion,
              );
              setDraft(template);
              setOperations(JSON.stringify(template.operations, null, 2));
            }}
          >
            <SelectItem value="choice" text="TypeSafe AI classification" />
            <SelectItem
              value="injection"
              text="Wolf Defender injection guard"
            />
          </Select>
        )}
        {(
          [
            ["id", "Expert ID"],
            ["name", "Display name"],
            ["bean", "Camel bean name"],
            ["dependency", "Implementation dependency"],
          ] as const
        ).map(([field, label]) => (
          <TextInput
            key={field}
            id={`expert-${field}`}
            labelText={label}
            value={draft[field] ?? ""}
            disabled={busy || (field === "id" && Boolean(expert))}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setDraft({ ...draft, [field]: event.target.value })
            }
          />
        ))}
        <Checkbox
          id="expert-confidence"
          labelText="Supports confidence controls"
          checked={draft.supportsConfidence ?? false}
          onChange={(_event, { checked }) =>
            setDraft({ ...draft, supportsConfidence: checked })
          }
        />
        <TextArea
          id="expert-operations"
          labelText="Operations and parameter JSON Schemas"
          rows={12}
          value={operations}
          helperText="Each operation declares name, inputTypes, resultType, resultMeaning, and parameterSchema. Use text inputs for classifier and guard operations."
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
            setOperations(event.target.value)
          }
        />
        <p>
          Configure the named bean, credentials, model, and connection settings
          in the WSR deployment. Catalog entries describe capabilities.
        </p>
        {error && (
          <InlineNotification
            kind="error"
            title="Could not save expert"
            subtitle={error}
            hideCloseButton
          />
        )}
      </div>
    </Modal>
  );
}
