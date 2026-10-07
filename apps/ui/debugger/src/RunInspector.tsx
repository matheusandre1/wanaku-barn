import { createPortal } from "react-dom";
import { Accordion, AccordionItem, Button, ComposedModal, ModalBody, ModalHeader, TextArea, Theme } from "@carbon/react";
import { exportRun, toCurl, type Run } from "./client";
import { JsonCode } from "./JsonCode";

interface RunInspectorProps {
  run: Run;
  editedBody: string;
  onBody: (body: string) => void;
  onClose: () => void;
  onReplay: () => void;
}
function download(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
export function RunInspector({ run, editedBody, onBody, onClose, onReplay }: RunInspectorProps) {
  const { body, ...metadata } = run.request;
  return createPortal(
    <Theme theme="white" className="wanaku-debugger-modal">
      <ComposedModal open aria-label="Run inspector" onClose={onClose} size="lg" preventCloseOnClickOutside selectorPrimaryFocus=".debugger-replay">
        <ModalHeader title="Run inspector" closeModal={onClose} />
        <ModalBody hasScrollingContent>
          <p className="debugger-request-url">{run.request.method} {run.request.url}</p>
          <p>{run.summary} · {run.outcome} · HTTP {run.status ?? "unavailable"} · {run.durationMs} ms · {run.startedAt}</p>
          <div className="debugger-actions">
            <Button className="debugger-replay" onClick={onReplay}>Replay run</Button>
            <Button kind="secondary" onClick={() => download(`wanaku-run-${run.id}.json`, exportRun(run), "application/json")}>Export run JSON</Button>
            <Button kind="secondary" onClick={() => void navigator.clipboard.writeText(toCurl(run.request))}>Copy curl</Button>
            <Button kind="secondary" onClick={() => download(`wanaku-run-${run.id}.sh`, toCurl(run.request), "text/plain")}>Export curl</Button>
          </div>
          <TextArea id="replay-body" labelText="Edit request body for replay" value={editedBody} onChange={(e) => onBody(e.target.value)} />
          <Accordion>
            <AccordionItem title="Request">
              <JsonCode value={metadata} label="Request metadata JSON" />
              {body !== undefined && <JsonCode value={body} label="Request body JSON" />}
            </AccordionItem>
            <AccordionItem title="Response" open>
              <JsonCode value={run.responseHeaders} label="Response headers JSON" />
              <JsonCode value={run.response || run.error || "(empty response)"} label="Response body JSON" />
            </AccordionItem>
            <AccordionItem title="Policy and audit">
              <p>Audit events match this run time window and may include concurrent requests.</p>
              {run.auditUrl && <a href={run.auditUrl} target="_blank" rel="noreferrer">Matching audit events</a>}
              <JsonCode value={run.audit ?? []} label="Audit events JSON" />
              {run.auditError && <p>Audit unavailable: {run.auditError}</p>}
            </AccordionItem>
          </Accordion>
        </ModalBody>
      </ComposedModal>
    </Theme>, document.body,
  );
}
