import type {
  CheckerJson,
  Finding,
  ModuleItem,
  RuleItem,
  ReasoningFlag,
  SourceAnchor,
} from '../types';

// ─── Rule → Finding ───────────────────────────────────────────────────────────

function ruleToFinding(rule: RuleItem, module: ModuleItem): Finding {
  const anchor = rule.detail?.source_anchor ?? null;
  return {
    id: `${module.module_id}-${rule.rule_id}`,
    moduleId: module.module_id,
    moduleName: module.module_name,
    ruleId: rule.rule_id,
    title: rule.rule_description,
    severity: rule.severity,
    status: rule.status,
    statusColour: rule.status_colour ?? 'grey',
    summary: rule.summary,
    explanation: rule.detail?.explanation ?? '',
    recommendation: rule.detail?.recommendation ?? '',
    page: anchor?.page ?? null,
    anchorText: anchor?.anchor_phrase ?? null,
    sourceFile: anchor?.source_file ?? null,
    sourceAnchors: anchor ? [anchor] : [],
    checkTypes: rule.check_types ?? [],
    kind: 'rule',
    raw: rule,
  };
}

// ─── ReasoningFlag → Finding ──────────────────────────────────────────────────

function flagToFinding(flag: ReasoningFlag): Finding {
  const anchors: SourceAnchor[] = [];

  if (Array.isArray(flag.detail?.source_anchors)) {
    for (const a of flag.detail.source_anchors) {
      if (a && a.page !== null) anchors.push(a);
    }
  } else if (flag.detail?.source_anchor) {
    const a = flag.detail.source_anchor;
    if (a.page !== null) anchors.push(a);
  }

  const primaryAnchor =
    anchors.find((a) => a.anchor_phrase !== null) ?? anchors[0] ?? null;

  return {
    id: flag.flag_id,
    moduleId: 'RF',
    moduleName: 'Reasoning Flags',
    ruleId: flag.flag_id,
    title: flag.category.replace(/_/g, ' '),
    severity: flag.severity,
    status: 'Flag',
    statusColour: flag.status_colour ?? 'amber',
    summary: flag.summary,
    explanation: flag.detail?.explanation ?? '',
    recommendation: flag.detail?.recommendation ?? '',
    page: primaryAnchor?.page ?? null,
    anchorText: primaryAnchor?.anchor_phrase ?? null,
    sourceFile: primaryAnchor?.source_file ?? null,
    sourceAnchors: anchors,
    checkTypes: [],
    category: flag.category,
    kind: 'reasoning_flag',
    raw: flag,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert any CheckerJson (in the standard schema) into a flat Finding[].
 * This is the single normalization boundary — all components consume Finding[].
 */
export function normalizeFindings(json: CheckerJson): Finding[] {
  const findings: Finding[] = [];

  for (const module of json.modules ?? []) {
    for (const rule of module.rules ?? []) {
      findings.push(ruleToFinding(rule, module));
    }
  }

  for (const flag of json.reasoning_flags ?? []) {
    findings.push(flagToFinding(flag));
  }

  return findings;
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

/** Negative-first, then Critical→Low within each status tier. */
const STATUS_PRIORITY: Record<string, number> = {
  Absent: 0,
  Insufficient: 1,
  Flag: 2,
  'Not Applicable': 3,
  Present: 4,
};

const SEVERITY_PRIORITY: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const sA = STATUS_PRIORITY[a.status] ?? 5;
    const sB = STATUS_PRIORITY[b.status] ?? 5;
    if (sA !== sB) return sA - sB;
    const vA = SEVERITY_PRIORITY[a.severity] ?? 5;
    const vB = SEVERITY_PRIORITY[b.severity] ?? 5;
    return vA - vB;
  });
}

/** Group findings into an ordered map of moduleId → Finding[]. */
export function groupByModule(findings: Finding[]): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!map.has(f.moduleId)) map.set(f.moduleId, []);
    map.get(f.moduleId)!.push(f);
  }
  return map;
}

/** Collect unique values for each filter dimension. */
export function collectFilterOptions(findings: Finding[]) {
  const severities = [...new Set(findings.map((f) => f.severity))];
  // Status values only from rule findings (reasoning flags use 'Flag' which is tab-gated)
  const statuses = [
    ...new Set(
      findings.filter((f) => f.kind === 'rule').map((f) => f.status),
    ),
  ];
  // Module IDs only from rule findings; 'RF' is not a filterable module
  const moduleIds = [
    ...new Set(
      findings.filter((f) => f.kind === 'rule').map((f) => f.moduleId),
    ),
  ];
  const moduleNames = new Map(findings.map((f) => [f.moduleId, f.moduleName]));
  // Categories from reasoning flags only
  const categories = [
    ...new Set(
      findings
        .filter((f) => f.kind === 'reasoning_flag' && f.category)
        .map((f) => f.category!),
    ),
  ];
  return { severities, statuses, moduleIds, moduleNames, categories };
}
