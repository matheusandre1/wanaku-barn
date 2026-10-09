import React, {useState} from "react";
import {
  Button, DataTable, Pagination, Select, SelectItem, Table, TableBody, TableCell,
  TableContainer, TableHead, TableHeader, TableRow, TableToolbar, TableToolbarContent,
  TableToolbarSearch, Tag,
} from "@carbon/react";
import {Add, Download, TrashCan, View} from "@carbon/react/icons";
import type {DataStoreRecord} from "../../models";
import {formatTimestamp, isProtectedRecord, matchesSearch, recordType} from "./data-store-display";
import "./data-stores.scss";

interface DataStoresTableProps {
  dataStores: DataStoreRecord[];
  onDelete: (record: DataStoreRecord) => void;
  onAdd: () => void;
  onDownload: (record: DataStoreRecord) => void;
  onView: (record: DataStoreRecord) => void;
  downloading: boolean;
}

const headers = [
  {key: "name", header: "Name"}, {key: "type", header: "Stored type"},
  {key: "labels", header: "Labels"}, {key: "createdAt", header: "Created"},
  {key: "updatedAt", header: "Updated"}, {key: "revision", header: "Revision"},
  {key: "actions", header: "Actions"},
];

function displayRows(records: Map<string, DataStoreRecord>) {
  return [...records].map(([id, record]) => ({
    id, name: record.name || "Unnamed record", type: recordType(record),
    labels: Object.entries(record.labels || {}).filter(([key]) => key !== "wanaku.type").map(([key, value]) => `${key}=${value}`).join(", ") || "No additional labels",
    createdAt: formatTimestamp(record.createdAt), updatedAt: formatTimestamp(record.updatedAt),
    revision: record.revision ?? "Not recorded", actions: "",
  }));
}

export const DataStoresTable: React.FC<DataStoresTableProps> = ({
  dataStores, onDelete, onAdd, onDownload, onView, downloading,
}) => {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const types = [...new Set(dataStores.map(recordType))].sort();
  const filtered = dataStores.filter(record => matchesSearch(record, query) && (!type || recordType(record) === type));
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const records = new Map(visible.map((record, index) => [record.id || `record-${index}`, record]));
  const rows = displayRows(records);

  return <div className="data-stores">
    <Select id="data-store-type" labelText="Filter by stored type" value={type}
      onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {setType(event.target.value); setPage(1);}}>
      <SelectItem value="" text="All types" />
      {types.map(value => <SelectItem key={value} value={value} text={value} />)}
    </Select>
    <DataTable rows={rows} headers={headers}>
      {({rows, headers, getTableProps, getHeaderProps, getRowProps}) => <TableContainer
        title="Stored records" description={`${dataStores.length} records in the data store. Dates use your local time zone.`}>
        <TableToolbar><TableToolbarContent>
          <TableToolbarSearch persistent placeholder="Search names, IDs, labels or actors" value={query}
            onChange={(_event, value?: string) => {setQuery(value || ""); setPage(1);}} />
          <Button renderIcon={Add} onClick={onAdd}>Add Data Store</Button>
        </TableToolbarContent></TableToolbar>
        <div className="data-stores__scroll"><Table {...getTableProps()}>
          <TableHead><TableRow>{headers.map(header => <TableHeader {...getHeaderProps({header})} key={header.key}>{header.header}</TableHeader>)}</TableRow></TableHead>
          <TableBody>{rows.length === 0 ? <TableRow><TableCell colSpan={headers.length}>
            {dataStores.length === 0 ? 'No stored records. Use "Add Data Store" to upload a file.' : "No records match your search and type filter."}
          </TableCell></TableRow> : rows.map(row => {
            const record = records.get(row.id);
            // Carbon synchronizes its internal rows after props change; omit stale rows during that render.
            if (!record) return null;
            const {key, ...rowProps} = getRowProps({row});
            return <TableRow key={key} {...rowProps}>{row.cells.map(cell => <TableCell key={cell.id}>
              {cell.info.header === "actions" ? <RecordActions record={record} onView={onView} onDownload={onDownload} onDelete={onDelete} downloading={downloading} /> : cell.info.header === "type" ? <Tag type="gray">{String(cell.value)}</Tag> : cell.value}
            </TableCell>)}</TableRow>;
          })}</TableBody>
        </Table></div>
      </TableContainer>}
    </DataTable>
    <Pagination totalItems={filtered.length} page={currentPage} pageSize={pageSize} pageSizes={[10, 25, 50]}
      onChange={({page, pageSize}) => {setPage(page); setPageSize(pageSize);}} />
  </div>;
};

function RecordActions({record, onView, onDownload, onDelete, downloading}: {
  record: DataStoreRecord;
} & Pick<DataStoresTableProps, "onView" | "onDownload" | "onDelete" | "downloading">) {
  const protectedRecord = isProtectedRecord(record);
  return <div className="data-stores__actions">
    <Button kind="ghost" renderIcon={View} hasIconOnly iconDescription="View" onClick={() => onView(record)} />
    <Button kind="ghost" renderIcon={Download} hasIconOnly iconDescription="Download" disabled={downloading} onClick={() => onDownload(record)} />
    <Button kind="ghost" renderIcon={TrashCan} hasIconOnly
      iconDescription={protectedRecord ? "Managed record: delete from its feature page" : "Delete"}
      disabled={!record.id || protectedRecord} onClick={() => onDelete(record)} />
  </div>;
}
