export type RelationKindId =
  | "rel.contains.table"
  | "rel.contains.column"
  | "rel.pk_of"
  | "rel.fk_references"
  | "rel.doc_links_issue"
  | "rel.doc_links_doc"
  | "rel.work_links_work"
  | "rel.doc_contains_attachment"
  | "rel.drive_contains_item"
  | "rel.drive_shares_with";

export type RelationKind = {
  id: RelationKindId;
  label: string;
  description: string;
  fromTypes: string[];
  toTypes: string[];
  symmetric?: boolean;
};

export const RELATION_KINDS: RelationKind[] = [
  {
    id: "rel.contains.table",
    label: "Dataset contains table",
    description: "Dataset contains a table or view.",
    fromTypes: ["catalog.dataset"],
    toTypes: ["catalog.table"],
  },
  {
    id: "rel.contains.column",
    label: "Table contains column",
    description: "Table contains a column.",
    fromTypes: ["catalog.table"],
    toTypes: ["catalog.column"],
  },
  {
    id: "rel.pk_of",
    label: "Primary key column",
    description: "Table has a primary key column.",
    fromTypes: ["catalog.table"],
    toTypes: ["catalog.column"],
  },
  {
    id: "rel.fk_references",
    label: "Foreign key",
    description: "Foreign key column references a primary key column.",
    fromTypes: ["catalog.column"],
    toTypes: ["catalog.column"],
  },
  {
    id: "rel.doc_links_issue",
    label: "Doc links issue",
    description: "Document links to a work item (issue/task).",
    fromTypes: ["doc.item", "doc.page"],
    toTypes: ["work.item"],
  },
  {
    id: "rel.doc_links_doc",
    label: "Doc links doc",
    description: "Document links to another document.",
    fromTypes: ["doc.item", "doc.page"],
    toTypes: ["doc.item", "doc.page"],
    symmetric: true,
  },
  {
    id: "rel.work_links_work",
    label: "Work links work",
    description: "Work item links to another work item (blocks, duplicates, etc.).",
    fromTypes: ["work.item"],
    toTypes: ["work.item"],
  },
  {
    id: "rel.doc_contains_attachment",
    label: "Doc contains attachment",
    description: "Document/page contains an attachment/file.",
    fromTypes: ["doc.item", "doc.page"],
    toTypes: ["doc.attachment", "doc.file"],
  },
  {
    id: "rel.drive_contains_item",
    label: "Drive contains item",
    description: "Drive/folder contains a file or child folder.",
    fromTypes: ["drive", "drive.folder"],
    toTypes: ["drive.folder", "drive.file", "doc.file"],
  },
  {
    id: "rel.drive_shares_with",
    label: "Drive item shared with principal",
    description: "Drive item is shared with a user/group (share link).",
    fromTypes: ["drive.file", "doc.file"],
    toTypes: ["principal.user", "principal.group"],
  },
];

export function getRelationKind(id: RelationKindId): RelationKind | undefined {
  return RELATION_KINDS.find((kind) => kind.id === id);
}
