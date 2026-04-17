// ─── Raw JSON schema types ────────────────────────────────────────────────────

export interface CheckerJsonMeta {
  rulebook_version: string;
  company_name: string;
  analysis_date: string;
}

export interface SourceAnchor {
  source_file: string | null;
  page: number | null;
  anchor_phrase: string | null;
}

export interface RuleDetail {
  explanation: string;
  recommendation?: string;
  source_anchor: SourceAnchor;
}

export interface RuleItem {
  rule_id: string;
  rule_description: string;
  check_types?: string[];
  severity: string;
  status: string;
  status_colour: string;
  summary: string;
  detail: RuleDetail;
}

export interface ReasoningFlagDetail {
  explanation: string;
  recommendation?: string;
  source_anchors?: SourceAnchor[];
  source_anchor?: SourceAnchor;
}

export interface ReasoningFlag {
  flag_id: string;
  category: string;
  severity: string;
  status_colour: string;
  rules_triggered?: string[];
  summary: string;
  detail: ReasoningFlagDetail;
}

export interface ModuleItem {
  module_id: string;
  module_name: string;
  triggered: boolean;
  rules: RuleItem[];
}

export interface CheckerJson {
  meta: CheckerJsonMeta;
  modules: ModuleItem[];
  reasoning_flags?: ReasoningFlag[];
  [key: string]: unknown;
}

// ─── Normalized finding (reusable across any JSON in this schema) ─────────────

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low' | string;
export type FindingStatus =
  | 'Present'
  | 'Insufficient'
  | 'Absent'
  | 'Not Applicable'
  | 'Flag'
  | string;
export type FindingKind = 'rule' | 'reasoning_flag';

export interface Finding {
  id: string;
  moduleId: string;
  moduleName: string;
  ruleId: string;
  title: string;
  severity: Severity;
  status: FindingStatus;
  statusColour: string;
  summary: string;
  explanation: string;
  recommendation: string;
  /** Primary page from first anchor with a page value */
  page: number | null;
  /** Primary anchor phrase */
  anchorText: string | null;
  sourceFile: string | null;
  /** All anchors (for flags with multiple anchors) */
  sourceAnchors: SourceAnchor[];
  /** Check type codes: D, T, K, L, R */
  checkTypes: string[];
  /** Raw category string from JSON (only present on reasoning_flag items) */
  category?: string;
  kind: FindingKind;
  raw: RuleItem | ReasoningFlag;
}

// ─── PDF anchor matching ──────────────────────────────────────────────────────

export type MatchStatus = 'matched' | 'unresolved' | 'ambiguous' | 'no_anchor' | 'no_page';

export interface TextRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MatchCandidate {
  page: number;
  rects: TextRect[];
  anchorIndex: number; // which sourceAnchor this came from
}

export interface MatchResult {
  findingId: string;
  status: MatchStatus;
  selectedCandidateIndex: number; // index into candidates array
  candidates: MatchCandidate[];
}

// ─── Extracted PDF text layer ─────────────────────────────────────────────────

export interface TextItem {
  str: string;
  transform: number[]; // [a, b, c, d, e, f]
  width: number;
  height: number;
  fontName?: string;
}

export interface PageTextData {
  pageNumber: number;
  items: TextItem[];
  viewportHeight: number; // viewport height at scale=1.0, used for coordinate flipping
}

// ─── Filter and UI state ─────────────────────────────────────────────────────

export interface FilterState {
  /** Top-level tab — drives which kind of finding is shown */
  tab: 'rules' | 'flags';
  severity: string[];
  /** Applies only in the Basic Rules tab */
  status: string[];
  /** Applies only in the Basic Rules tab */
  moduleId: string[];
  /** Applies only in the Basic Rules tab */
  checkType: string[];
  /** Applies only in the Overall Reasoning tab */
  category: string[];
  search: string;
}

export type ViewMode = 'grouped' | 'flat';

// ─── Asset config (swap in any prospectus set) ───────────────────────────────

export interface AssetConfig {
  prospectusUrl: string;
  checkerJsonUrl: string;
  rulebookUrl: string;
  label?: string; // e.g. "Black Sesame Technologies"
}
