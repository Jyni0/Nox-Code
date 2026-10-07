export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
}

export interface FileContent {
  content: string;
  binary: boolean;
  size: number;
  lineEnding: "LF" | "CRLF";
  bom: boolean;
}

export interface SearchOptions {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  include: string;
  exclude: string;
  maxResults?: number;
}

export interface SearchMatch {
  line: number;
  col: number;
  len: number;
  preview: string;
}

export interface SearchFile {
  path: string;
  rel: string;
  matches: SearchMatch[];
}

export interface SearchResult {
  files: SearchFile[];
  totalMatches: number;
  truncated: boolean;
}

export interface ReplaceResult {
  filesChanged: number;
  replacements: number;
}

export type GitStatus = "M" | "A" | "D" | "R" | "?" | "U" | "C" | "T";

export interface GitFile {
  path: string;
  status: GitStatus;
  staged: boolean;
  unstaged: boolean;
}

export interface GitInfo {
  isRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
}

/** A shell the integrated terminal can start. */
export interface ShellProfile {
  id: string;
  name: string;
  program: string;
  args: string[];
}
