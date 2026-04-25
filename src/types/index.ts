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

export interface V4FindingItem {
  check_type: string;
  check_label: string;
  severity: string;
  issue_type: string;
  explanation: string;
  recommendation: string;
  source_anchor: SourceAnchor;
}

export interface V4LegacyIssueRuleItem {
  rule_id: string;
  rule_description: string;
  findings: V4FindingItem[];
}

export interface V4RuleStatusItem {
  rule_id: string;
  rule_description: string;
  status: 'clear' | 'has_issues' | 'not_applicable' | string;
  analysis: string;
  source_anchor?: SourceAnchor | null;
  findings?: V4FindingItem[];
}

export type AnyRuleItem = RuleItem | V4LegacyIssueRuleItem | V4RuleStatusItem;

export interface FilterTags {
  has_disclosure_issue: boolean;
  has_threshold_issue: boolean;
  has_consistency_issue: boolean;
  has_language_issue: boolean;
  has_reasoning_issue: boolean;
  highest_severity: string | null;
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
  status_colour?: string;
  detail?: ReasoningFlagDetail;
  explanation?: string;
  recommendation?: string;
  source_anchors?: SourceAnchor[];
  rules_triggered?: string[];
  summary: string;
}

export interface ModuleItem {
  module_id: string;
  module_name: string;
  triggered: boolean;
  not_applicable_reason?: string;
  filter_tags?: FilterTags;
  rules: AnyRuleItem[];
}

export interface CheckerJson {
  meta: CheckerJsonMeta;
  modules: ModuleItem[];
  reasoning_flags?: ReasoningFlag[];
  [key: string]: unknown;
}

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
  parentFindingId?: string;
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
  page: number | null;
  anchorText: string | null;
  sourceFile: string | null;
  sourceAnchors: SourceAnchor[];
  checkTypes: string[];
  findings?: V4FindingItem[];
  category?: string;
  kind: FindingKind;
  raw: AnyRuleItem | ReasoningFlag;
}

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
  anchorIndex: number;
}

export interface MatchResult {
  findingId: string;
  status: MatchStatus;
  selectedCandidateIndex: number;
  candidates: MatchCandidate[];
}

export interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
}

export interface PageTextData {
  pageNumber: number;
  items: TextItem[];
  viewportHeight: number;
}

export interface FilterState {
  tab: 'rules' | 'flags';
  severity: string[];
  status: string[];
  moduleId: string[];
  checkType: string[];
  category: string[];
  review: 'pending' | 'approved' | 'dismissed' | 'all';
  search: string;
}

export type ViewMode = 'grouped' | 'flat';

export type ReviewDecision = 'approved' | 'dismissed';
export type ReviewFilter = FilterState['review'];

export interface AssetConfig {
  prospectusUrl: string;
  checkerJsonUrl: string;
  rulebookUrl: string;
  label?: string;
}
