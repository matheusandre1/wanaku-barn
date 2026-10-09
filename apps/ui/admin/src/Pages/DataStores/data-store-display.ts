import type {DataStoreRecord} from "../../models";

export function formatTimestamp(value?: string): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function recordType(record: DataStoreRecord): string {
  return record.labels?.["wanaku.type"] || "Unspecified";
}

export function matchesSearch(record: DataStoreRecord, query: string): boolean {
  if (!query.trim()) return true;
  const values = [record.name, record.id, record.createdBy, record.updatedBy,
    ...Object.entries(record.labels || {}).flat()];
  return values.some(value => value?.toLowerCase().includes(query.trim().toLowerCase()));
}

export function isProtectedRecord(record: DataStoreRecord): boolean {
  const type = record.labels?.["wanaku.type"] || "";
  return ["catalog", "catalog.removed", "template", "template.removed", "kamelet-current", "kamelet-revision"].includes(type)
    || record.labels?.["semantic.immutable"] === "true"
    || record.labels?.["kamelet.immutable"] === "true"
    || [record.name, record.id].some(value => value?.startsWith("kamelet-revision-") || value?.startsWith("kamelet-current-"));
}
