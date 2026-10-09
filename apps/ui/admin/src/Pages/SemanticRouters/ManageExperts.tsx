import { useEffect, useState } from "react";
import {
  Button,
  InlineNotification,
  Modal,
  SkeletonText,
  Tile,
} from "@carbon/react";
import type { SemanticExpert } from "../../models";
import { semanticRouterApi } from "./api";
import { ExpertEditor } from "./ExpertEditor";
import { getErrorMessage } from "../../utils/error";

interface ManageExpertsProps {
  onClose: () => void;
  onChanged: () => void;
}
type ExpertState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "success"; experts: SemanticExpert[] };

export function ManageExperts({ onClose, onChanged }: ManageExpertsProps) {
  const [state, setState] = useState<ExpertState>({ status: "loading" });
  const [editing, setEditing] = useState<{
    expert: SemanticExpert | null;
  } | null>(null);
  const [removing, setRemoving] = useState<SemanticExpert | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try {
      setState({
        status: "success",
        experts: await semanticRouterApi.experts(),
      });
    } catch (cause) {
      setState({ status: "error", error: getErrorMessage(cause) });
    }
  };
  useEffect(() => {
    let active = true;
    semanticRouterApi
      .experts()
      .then((experts) => {
        if (active) setState({ status: "success", experts });
      })
      .catch((cause) => {
        if (active)
          setState({ status: "error", error: getErrorMessage(cause) });
      });
    return () => {
      active = false;
    };
  }, []);
  const save = async (expert: SemanticExpert) => {
    await semanticRouterApi.saveExpert(expert, Boolean(editing?.expert));
    await load();
    onChanged();
  };
  const remove = async () => {
    if (!removing?.id) return;
    setBusy(true);
    setError(null);
    try {
      await semanticRouterApi.removeExpert(removing.id);
      setRemoving(null);
      await load();
      onChanged();
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const version =
    state.status === "success"
      ? state.experts
          .find((expert) => expert.dependency?.startsWith("org.apache.camel:"))
          ?.dependency?.split(":")[2]
      : undefined;
  return (
    <>
      <Modal
        open={!editing && !removing}
        passiveModal
        modalHeading="Manage experts"
        onRequestClose={onClose}
      >
        <div className="semantic-router-fields">
          <p>
            Manage the expert catalog used by classifiers and optional guards.
            Deployment settings remain in WSR.
          </p>
          {state.status === "loading" && (
            <SkeletonText paragraph lineCount={3} />
          )}
          {state.status === "error" && (
            <>
              <InlineNotification
                kind="error"
                title="Could not load experts"
                subtitle={state.error}
                hideCloseButton
              />
              <Button kind="tertiary" onClick={() => void load()}>
                Retry
              </Button>
            </>
          )}
          {state.status === "success" && (
            <>
              <Button onClick={() => setEditing({ expert: null })}>
                Add expert
              </Button>
              {state.experts.length === 0 && (
                <p>No experts yet. Add a classifier or guard expert.</p>
              )}
              {state.experts.map((expert) => (
                <Tile key={expert.id} className="semantic-router-fields">
                  <h3>{expert.name || expert.id}</h3>
                  <p>{expert.bean}</p>
                  <p>{expert.dependency}</p>
                  <p>
                    {expert.operations
                      ?.map(
                        (operation) =>
                          `${operation.name}: ${operation.resultMeaning}`,
                      )
                      .join("; ") || "Legacy choice expert"}
                  </p>
                  <div className="semantic-router-buttons">
                    <Button
                      kind="tertiary"
                      size="sm"
                      aria-label={`Edit expert ${expert.name || expert.id}`}
                      onClick={() => setEditing({ expert })}
                    >
                      Edit
                    </Button>
                    <Button
                      kind="danger--ghost"
                      size="sm"
                      aria-label={`Remove expert ${expert.name || expert.id}`}
                      onClick={() => {
                        setError(null);
                        setRemoving(expert);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </Tile>
              ))}
            </>
          )}
        </div>
      </Modal>
      {editing && (
        <ExpertEditor
          expert={editing.expert}
          camelVersion={version ?? "4.23.0-SNAPSHOT"}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
      <Modal
        open={Boolean(removing)}
        danger
        modalHeading="Remove expert?"
        primaryButtonText="Remove expert"
        secondaryButtonText="Cancel"
        primaryButtonDisabled={busy}
        onRequestSubmit={() => void remove()}
        onRequestClose={() => {
          if (!busy) setRemoving(null);
        }}
      >
        <p>
          Remove {removing?.name || removing?.id} from the catalog? Experts
          referenced by drafts cannot be removed. Published revisions retain
          their snapshots.
        </p>
        {error && (
          <InlineNotification
            kind="error"
            title="Could not remove expert"
            subtitle={error}
            hideCloseButton
          />
        )}
      </Modal>
    </>
  );
}
