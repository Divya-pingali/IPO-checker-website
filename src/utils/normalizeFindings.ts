import type {
  CheckerJson,
  Finding,
  ModuleItem,
  AnyRuleItem,
  RuleItem,
  V4LegacyIssueRuleItem,
  V4RuleStatusItem,
  V4FindingItem,
  ReasoningFlag,
  SourceAnchor,
} from '../types';

function isV3Rule(rule: unknown): rule is RuleItem {
  return !!rule && typeof rule === 'object' && 'detail' in rule;
}

function isV4StatusRule(rule: unknown): rule is V4RuleStatusItem {
  return !!rule && typeof rule === 'object' && 'status' in rule && 'analysis' in rule;
}

function isV4LegacyIssueRule(rule: unknown): rule is V4LegacyIssueRuleItem {
  return !!rule && typeof rule === 'object' && 'findings' in rule && !('status' in rule);
}

const STATUS_COLOUR: Record<string, string> = {
  Absent: 'red',
  Insufficient: 'amber',
  Present: 'green',
  'Not Applicable': 'grey',
  Flag: 'amber',
};

const SEVERITY_RANK = ['Critical', 'High', 'Medium', 'Low'];

function normalizeStatus(status: string, findings?: V4FindingItem[]): string {
  if (status === 'clear') return 'Present';
  if (status === 'not_applicable') return 'Not Applicable';
  if (status === 'has_issues') {
    return findings?.some((f) => f.issue_type === 'Absent') ? 'Absent' : 'Insufficient';
  }
  return status;
}

function highestSeverity(items: V4FindingItem[]): string {
  return items.reduce((worst, item) => {
    const wi = SEVERITY_RANK.indexOf(worst);
    const ci = SEVERITY_RANK.indexOf(item.severity);
    return ci !== -1 && (wi === -1 || ci < wi) ? item.severity : worst;
  }, items[0]?.severity ?? 'High');
}

function dedupeAnchors(anchors: SourceAnchor[]): SourceAnchor[] {
  const seen = new Set<string>();
  return anchors.filter((anchor) => {
    const key = `${anchor.source_file ?? ''}|${anchor.page ?? ''}|${anchor.anchor_phrase ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function v3RuleToFinding(rule: RuleItem, module: ModuleItem): Finding {
  const anchor = rule.detail?.source_anchor ?? null;
  return {
    id: `${module.module_id}-${rule.rule_id}`,
    moduleId: module.module_id,
    moduleName: module.module_name,
    ruleId: rule.rule_id,
    title: rule.rule_description,
    severity: rule.severity,
    status: rule.status,
    statusColour: rule.status_colour ?? STATUS_COLOUR[rule.status] ?? 'grey',
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

function v4StatusRuleToFinding(rule: V4RuleStatusItem, module: ModuleItem): Finding {
  const items = Array.isArray(rule.findings) ? rule.findings : [];
  const status = normalizeStatus(rule.status, items);
  const allAnchors = dedupeAnchors(
    items.length > 0
      ? items
          .map((f) => f.source_anchor)
          .filter((a): a is SourceAnchor => a != null)
      : rule.source_anchor
        ? [rule.source_anchor]
        : [],
  );
  const primaryAnchor = allAnchors.find((a) => a.page != null) ?? null;
  const primaryPhrase = allAnchors.find((a) => a.anchor_phrase != null) ?? primaryAnchor;
  const checkTypes = [...new Set(items.map((f) => f.check_type))];

  return {
    id: `${module.module_id}-${rule.rule_id}`,
    moduleId: module.module_id,
    moduleName: module.module_name,
    ruleId: rule.rule_id,
    title: rule.rule_description,
    severity: items.length > 0 ? highestSeverity(items) : 'Low',
    status,
    statusColour: STATUS_COLOUR[status] ?? 'grey',
    summary: rule.analysis,
    explanation: rule.analysis,
    recommendation: items[0]?.recommendation ?? '',
    page: primaryAnchor?.page ?? null,
    anchorText: primaryPhrase?.anchor_phrase ?? null,
    sourceFile: primaryAnchor?.source_file ?? null,
    sourceAnchors: allAnchors,
    checkTypes,
    findings: items.length > 0 ? items : undefined,
    kind: 'rule',
    raw: rule,
  };
}

function v4LegacyRuleToFinding(rule: V4LegacyIssueRuleItem, module: ModuleItem): Finding {
  const items = rule.findings;
  const allAnchors = dedupeAnchors(
    items.map((f) => f.source_anchor).filter((a): a is SourceAnchor => a != null),
  );
  const primaryAnchor = allAnchors.find((a) => a.page != null) ?? null;
  const primaryPhrase = allAnchors.find((a) => a.anchor_phrase != null) ?? primaryAnchor;
  const status = items.some((f) => f.issue_type === 'Absent') ? 'Absent' : 'Insufficient';

  return {
    id: `${module.module_id}-${rule.rule_id}`,
    moduleId: module.module_id,
    moduleName: module.module_name,
    ruleId: rule.rule_id,
    title: rule.rule_description,
    severity: highestSeverity(items),
    status,
    statusColour: STATUS_COLOUR[status] ?? 'amber',
    summary: items[0]?.explanation ?? '',
    explanation: items[0]?.explanation ?? '',
    recommendation: items[0]?.recommendation ?? '',
    page: primaryAnchor?.page ?? null,
    anchorText: primaryPhrase?.anchor_phrase ?? null,
    sourceFile: primaryAnchor?.source_file ?? null,
    sourceAnchors: allAnchors,
    checkTypes: [...new Set(items.map((f) => f.check_type))],
    findings: items,
    kind: 'rule',
    raw: rule,
  };
}

function flagToFinding(flag: ReasoningFlag): Finding {
  const anchors: SourceAnchor[] = [];

  if (Array.isArray(flag.source_anchors)) {
    for (const a of flag.source_anchors) {
      if (a && a.page !== null) anchors.push(a);
    }
  }

  if (anchors.length === 0 && Array.isArray(flag.detail?.source_anchors)) {
    for (const a of flag.detail!.source_anchors!) {
      if (a && a.page !== null) anchors.push(a);
    }
  } else if (anchors.length === 0 && flag.detail?.source_anchor) {
    const a = flag.detail.source_anchor;
    if (a.page !== null) anchors.push(a);
  }

  const dedupedAnchors = dedupeAnchors(anchors);
  const primaryAnchor =
    dedupedAnchors.find((a) => a.anchor_phrase !== null) ?? dedupedAnchors[0] ?? null;

  const explanation = flag.explanation ?? flag.detail?.explanation ?? '';
  const recommendation = flag.recommendation ?? flag.detail?.recommendation ?? '';

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
    explanation,
    recommendation,
    page: primaryAnchor?.page ?? null,
    anchorText: primaryAnchor?.anchor_phrase ?? null,
    sourceFile: primaryAnchor?.source_file ?? null,
    sourceAnchors: dedupedAnchors,
    checkTypes: [],
    category: flag.category,
    kind: 'reasoning_flag',
    raw: flag,
  };
}

function mergeRulesByRuleId(rules: AnyRuleItem[]): AnyRuleItem[] {
  const map = new Map<string, AnyRuleItem>();
  const order: string[] = [];
  for (const rule of rules) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = rule as any;
    const id: string | undefined = r.rule_id;
    if (!id) continue;
    if (!map.has(id)) {
      // Shallow clone; copy findings array so we can mutate it safely
      const clone: AnyRuleItem = { ...rule } as AnyRuleItem;
      if (Array.isArray(r.findings)) (clone as any).findings = [...r.findings];
      map.set(id, clone);
      order.push(id);
    } else {
      const existing = map.get(id)! as any;
      const incoming: V4FindingItem[] = r.findings ?? [];
      existing.findings = [...(existing.findings ?? []), ...incoming];
    }
  }
  return order.map((id) => map.get(id)!);
}

export function normalizeFindings(json: CheckerJson): Finding[] {
  const findings: Finding[] = [];

  for (const module of json.modules ?? []) {
    const rules = mergeRulesByRuleId(module.rules ?? []);
    for (const rule of rules) {
      if (isV3Rule(rule)) {
        findings.push(v3RuleToFinding(rule, module));
      } else if (isV4StatusRule(rule)) {
        findings.push(v4StatusRuleToFinding(rule, module));
      } else if (isV4LegacyIssueRule(rule)) {
        findings.push(v4LegacyRuleToFinding(rule, module));
      }
    }
  }

  for (const flag of json.reasoning_flags ?? []) {
    findings.push(flagToFinding(flag));
  }

  return findings;
}

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

export function groupByModule(findings: Finding[]): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!map.has(f.moduleId)) map.set(f.moduleId, []);
    map.get(f.moduleId)!.push(f);
  }
  return map;
}

export function collectFilterOptions(findings: Finding[]) {
  const severities = [...new Set(findings.map((f) => f.severity))];
  const statuses = [
    ...new Set(findings.filter((f) => f.kind === 'rule').map((f) => f.status)),
  ];
  const moduleIds = [
    ...new Set(findings.filter((f) => f.kind === 'rule').map((f) => f.moduleId)),
  ];
  const moduleNames = new Map(findings.map((f) => [f.moduleId, f.moduleName]));
  const categories = [
    ...new Set(
      findings
        .filter((f) => f.kind === 'reasoning_flag' && f.category)
        .map((f) => f.category!),
    ),
  ];
  return { severities, statuses, moduleIds, moduleNames, categories };
}
