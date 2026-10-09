import React from "react";
import {InlineNotification, Modal} from "@carbon/react";
import type {DataStoreRecord} from "../../models";
import {formatTimestamp, recordType} from "./data-store-display";
import "./data-stores.scss";

interface ViewDataStoreModalProps {
  dataStore: DataStoreRecord;
  onRequestClose: () => void;
}

type ContentPreview = {status: "text"; content: string} | {status: "unavailable"; message: string};

function previewContent(record: DataStoreRecord): ContentPreview {
  if (!record.data) return {status: "unavailable", message: "This record has no stored content."};
  try {
    const plainJson = ["semantic-definition", "semantic-publication", "semantic-current-publication"].includes(recordType(record));
    const bytes = plainJson ? undefined : Uint8Array.from(atob(record.data), character => character.charCodeAt(0));
    // ZIP archives and other binary files are available through Download, rather than rendered as text.
    const content = bytes ? new TextDecoder("utf-8", {fatal: true}).decode(bytes) : record.data;
    if (content.includes("\u0000") || content.startsWith("PK\u0003\u0004")) {
      return {status: "unavailable", message: "This record contains binary content. Download the file to inspect it."};
    }
    try {return {status: "text", content: JSON.stringify(JSON.parse(content), null, 2)};}
    catch {return {status: "text", content};}
  } catch {
    return {status: "unavailable", message: "A text preview is unavailable for this content. Download the file to inspect it."};
  }
}

export const ViewDataStoreModal: React.FC<ViewDataStoreModalProps> = ({dataStore, onRequestClose}) => {
  const preview = previewContent(dataStore);
  const metadata = [
    ["ID", dataStore.id || "Not recorded"], ["Name", dataStore.name || "Unnamed record"],
    ["Stored type", recordType(dataStore)], ["Revision", String(dataStore.revision ?? "Not recorded")],
    ["Created", formatTimestamp(dataStore.createdAt)], ["Created by", dataStore.createdBy || "Not recorded"],
    ["Updated", formatTimestamp(dataStore.updatedAt)], ["Updated by", dataStore.updatedBy || "Not recorded"],
  ];
  return <Modal open modalHeading={`View Data Store: ${dataStore.name || dataStore.id || "Unknown"}`}
    passiveModal onRequestClose={onRequestClose} size="lg">
    <dl className="data-stores__metadata">
      {metadata.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}
    </dl>
    <h3>Stored labels</h3>
    {Object.keys(dataStore.labels || {}).length === 0 ? <p>No labels stored.</p> :
      <dl className="data-stores__metadata">{Object.entries(dataStore.labels || {}).map(([key, value]) =>
        <React.Fragment key={key}><dt>{key}</dt><dd>{value}</dd></React.Fragment>)}</dl>}
    <h3>Content preview</h3>
    {preview.status === "text" ? <pre className="data-stores__content">{preview.content}</pre> :
      <InlineNotification kind="info" title="Preview unavailable" subtitle={preview.message} hideCloseButton />}
  </Modal>;
};
