import React, { useState } from 'react';

interface HelpScreenProps {
  onBack: () => void;
  onNewAnalysis: () => void;
}

const MODULES = [
  { id: '0', name: 'Pre-Conditions & Classification', desc: 'Confirms the applicant is a Specialist Technology Company, establishes Commercial or Pre-Commercial status, and determines the applicable market capitalisation tier — which sets the aggregate SII threshold for Module E.' },
  { id: 'A', name: 'Independence of SIIs', desc: 'Verifies each SII is independent of the applicant, controlling shareholders, and founders; no acting-in-concert arrangements; no agreements to return the investment.' },
  { id: 'B', name: 'Sophistication of SIIs', desc: 'Checks each SII meets at least one of the five qualification bases: AUM/fund ≥ HK$15bn, diverse portfolio ≥ HK$15bn, Specialist Technology focus ≥ HK$5bn, key market participant, or government/sovereign body.' },
  { id: 'C', name: 'Reference Dates', desc: 'Confirms all disclosed financial figures (AUM, fund size, portfolio) are dated within six months of the definitive agreement and within six months of the listing application date.' },
  { id: 'D', name: 'Pathfinder SIIs', desc: 'Checks that 2–5 Pathfinder SIIs are identified, each held for at least 12 months, and that aggregate (≥10% / HK$1.5bn) and individual (≥3% / HK$450m) thresholds are met.' },
  { id: 'E', name: 'Aggregate Investment Benchmark', desc: 'Verifies the combined SII shareholding meets the applicable percentage threshold (10–25% depending on market cap tier and Commercial/Pre-Commercial status).' },
  { id: 'F', name: 'Convertible Securities', desc: 'Triggered when SIIs hold convertible securities. Checks conversion mechanics are disclosed and that converted shares count toward (or are excluded from) the aggregate threshold as required.' },
  { id: 'G', name: 'Pathfinder SII Lock-Up', desc: 'Triggered when Pathfinder SIIs are designated. Verifies lock-up obligations and relevant disclosure.' },
  { id: 'H', name: 'SII Placees', desc: 'Triggered when SII Placees participate in the IPO placing. Checks Aggregate Investment Benchmark calculations, HKEX pre-submission for key market participants, and allotment announcement obligations.' },
  { id: 'I', name: 'Dual-Listed Applicants', desc: 'Triggered when the applicant is already listed overseas. Verifies that the overseas listing is disclosed and that its SII obligations are reconciled with HKEX requirements.' },
];

const SEVERITIES = [
  { level: 'Critical', colour: 'var(--c-critical)', bg: 'var(--c-critical-bg)', desc: 'A fundamental requirement. Non-compliance would be a material deficiency in the prospectus or a breach of listing eligibility. Must be resolved before listing.' },
  { level: 'High', colour: 'var(--c-high)', bg: 'var(--c-high-bg)', desc: 'A significant disclosure gap or threshold concern. Requires priority review by counsel; likely to draw HKEX comment.' },
  { level: 'Medium', colour: 'var(--c-medium)', bg: 'var(--c-medium-bg)', desc: 'A presentation or language quality issue. Not likely to cause a listing deficiency on its own but should be addressed before submission.' },
];

const STATUSES = [
  { status: 'Present', colour: 'var(--s-present)', bg: 'var(--s-present-bg)', desc: 'The rule was checked and the disclosure appears to satisfy the requirement based on the cited prospectus text.' },
  { status: 'Insufficient Information', colour: 'var(--s-insuf)', bg: 'var(--s-insuf-bg)', desc: 'A disclosure exists but is too vague, templated, or incomplete to confirm compliance. Requires improvement.' },
  { status: 'Absent', colour: 'var(--s-absent)', bg: 'var(--s-absent-bg)', desc: 'The required disclosure is entirely missing from the prospectus and should be added.' },
  { status: 'Not Applicable', colour: 'var(--s-na)', bg: 'var(--s-na-bg)', desc: 'The module\'s trigger condition was not met, so all its rules are marked N/A.' },
];

const CHECK_TYPES = [
  { type: 'D', name: 'Disclosure', desc: 'Is the required item present and specific enough to evaluate?' },
  { type: 'T', name: 'Threshold', desc: 'Does the disclosed figure meet the applicable quantitative benchmark?' },
  { type: 'K', name: 'Consistency', desc: 'Does the disclosure match equivalent data found in other sections of the prospectus?' },
  { type: 'L', name: 'Language', desc: 'Is the language accurate, plain, and not misleading — free of hedging or vague assertions?' },
  { type: 'R', name: 'Reasoning', desc: 'Does the disclosed evidence logically support the regulatory conclusion claimed?' },
];

export const HelpScreen: React.FC<HelpScreenProps> = ({ onBack, onNewAnalysis }) => {
  const [activeSection, setActiveSection] = useState<string>('about');

  const nav = [
    { id: 'about',      label: 'About' },
    { id: 'framework',  label: 'Regulatory Framework' },
    { id: 'modules',    label: 'The 10 Modules' },
    { id: 'findings',   label: 'Understanding Findings' },
    { id: 'rulebook',   label: 'Rulebook' },
  ];

  return (
    <div className="help-screen">
      {/* Top nav */}
      <header className="help-topbar">
        <div className="help-topbar__brand">
          <span className="help-topbar__title">IPO Prospectus Checker — Help</span>
        </div>
        <div className="help-topbar__actions">
          <button className="help-topbar__btn help-topbar__btn--ghost" onClick={onBack}>
            ← Back
          </button>
          <button className="help-topbar__btn help-topbar__btn--primary" onClick={onNewAnalysis}>
            ↑ New Analysis
          </button>
        </div>
      </header>

      <div className="help-body">
        {/* Sidebar nav */}
        <nav className="help-nav">
          {nav.map(({ id, label }) => (
            <button
              key={id}
              className={`help-nav__item${activeSection === id ? ' help-nav__item--active' : ''}`}
              onClick={() => setActiveSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="help-content">

          {activeSection === 'about' && (
            <section className="help-section">
              <h2 className="help-section__title">What this tool does</h2>
              <p className="help-section__body">
                The <strong>Edith IPO Prospectus Checker</strong> is a pre-submission
                review tool that checks Chapter 18C prospectus disclosures against the{' '}
                <strong>Meaningful Investment</strong> requirement across all 10 modules
                (Modules 0 and A–I).
              </p>
              <p className="help-section__body">
                The tool extracts the relevant sections from a prospectus PDF, sends them to
                the <strong>Gemini AI API</strong> together with the Edith compliance
                rulebook as context, and produces a structured report covering every rule in
                each module. Results are displayed in an interactive viewer with side-by-side
                PDF navigation and highlighted source passages.
              </p>

              <h3 className="help-section__sub">How to use it</h3>
              <ol className="help-list help-list--ol">
                <li>Upload a prospectus PDF (or Word document) on the main screen.</li>
                <li>Click <strong>Analyse</strong> — the tool extracts sections and runs the AI analysis (typically 2–5 minutes).</li>
                <li>Review findings in the sidebar, grouped by module or listed individually.</li>
                <li>Click any finding to jump to the relevant page in the prospectus PDF.</li>
                <li>Use the <strong>Rulebook</strong> button in the sidebar to open the Edith compliance rulebook alongside the prospectus.</li>
              </ol>

              <div className="help-callout help-callout--info">
                All findings are for human legal review. The tool is designed to
                over-flag rather than under-flag and does not make definitive compliance
                determinations.
              </div>
            </section>
          )}

          {activeSection === 'framework' && (
            <section className="help-section">
              <h2 className="help-section__title">Regulatory Framework</h2>

              <h3 className="help-section__sub">HKEX Chapter 18C</h3>
              <p className="help-section__body">
                Chapter 18C of the HKEX Main Board Listing Rules ("MB Rules") allows{' '}
                <strong>Specialist Technology Companies</strong> — companies primarily engaged
                in research, development, and commercialisation of specialist technology
                products — to list on the Hong Kong Stock Exchange. The definitions, accepted
                sectors, and listing criteria are set out in the official HKEX document{' '}
                <em>Section 2.5 — Specialist Technology Companies</em> (Guide for New Listing
                Applicants).
              </p>
              <p className="help-section__body">
                Accepted sectors (as defined by HKEX in the official Section 2.5 document)
                include: Next-generation IT (AI, cloud-based services), Advanced hardware
                &amp; software (semiconductors, robotics, EVs, aerospace), Advanced
                materials, New energy &amp; environmental protection, and New food &amp;
                agriculture technologies.
              </p>

              <h3 className="help-section__sub">The Meaningful Investment Requirement</h3>
              <p className="help-section__body">
                Under <strong>MB Rule 18C.11</strong> and the{' '}
                <em>Guide for New Listing Applicants</em> (paras 16–34), at least a specified
                percentage of a Chapter 18C applicant's total issued share capital must be
                held by <strong>Sophisticated Independent Investors (SIIs)</strong> at the
                time of listing.
              </p>

              <h3 className="help-section__sub">Applicable thresholds (aggregate SII holding)</h3>
              <table className="help-table">
                <thead>
                  <tr>
                    <th>Market Cap at Listing</th>
                    <th>Commercial Company</th>
                    <th>Pre-Commercial Company</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>Below HK$15bn</td><td>20%</td><td>25%</td></tr>
                  <tr><td>HK$15bn – HK$30bn</td><td>15%</td><td>20%</td></tr>
                  <tr><td>HK$30bn or above</td><td>10%</td><td>15%</td></tr>
                </tbody>
              </table>
              <p className="help-section__body" style={{ marginTop: 8 }}>
                <strong>Commercial Company:</strong> most recent audited revenue ≥ HK$250m and
                expected market cap ≥ HK$6bn (as modified from 1 Sep 2024).
              </p>

              <h3 className="help-section__sub">Sophisticated Independent Investors (SIIs)</h3>
              <p className="help-section__body">
                SIIs must be independent of the applicant and its controlling shareholders,
                and must qualify as "sophisticated" under at least one of five bases:
              </p>
              <ul className="help-list">
                <li><strong>Para 21(i):</strong> Asset manager or fund with AUM/fund size ≥ HK$15bn</li>
                <li><strong>Para 21(ii):</strong> Corporation with diverse investment portfolio ≥ HK$15bn</li>
                <li><strong>Para 21(iii):</strong> Investor with Specialist Technology focus ≥ HK$5bn</li>
                <li><strong>Para 21(iv):</strong> Key market participant in the applicant's industry</li>
                <li><strong>Para 21(v):</strong> Government body, sovereign wealth fund, or multilateral body</li>
              </ul>

              <h3 className="help-section__sub">Pathfinder SIIs</h3>
              <p className="help-section__body">
                A subset of SIIs that invested before the listing application. The prospectus
                must identify 2–5 Pathfinder SIIs, each holding for at least 12 months, with
                aggregate holding ≥ 10% or HK$1.5bn, and individual holding ≥ 3% or HK$450m.
              </p>
            </section>
          )}

          {activeSection === 'modules' && (
            <section className="help-section">
              <h2 className="help-section__title">The 10 Compliance Modules</h2>
              <p className="help-section__body">
                Module 0 is resolved first — its outputs (company type, market cap tier) drive
                threshold selection in all downstream modules. Modules A–E apply to all
                applicants. Modules F–I are conditional: they are only evaluated if their
                stated trigger condition is met.
              </p>
              <div className="help-modules">
                {MODULES.map((m) => (
                  <div key={m.id} className="help-module-card">
                    <div className="help-module-card__id">Module {m.id}</div>
                    <div className="help-module-card__name">{m.name}</div>
                    <div className="help-module-card__desc">{m.desc}</div>
                    {['F', 'G', 'H', 'I'].includes(m.id) && (
                      <span className="help-module-card__badge">Conditional</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeSection === 'findings' && (
            <section className="help-section">
              <h2 className="help-section__title">Understanding Findings</h2>

              <h3 className="help-section__sub">Severity levels</h3>
              <div className="help-legend">
                {SEVERITIES.map((s) => (
                  <div key={s.level} className="help-legend-item"
                       style={{ background: s.bg, borderLeft: `3px solid ${s.colour}` }}>
                    <span className="help-legend-item__label" style={{ color: s.colour }}>
                      {s.level}
                    </span>
                    <span className="help-legend-item__desc">{s.desc}</span>
                  </div>
                ))}
              </div>

              <h3 className="help-section__sub" style={{ marginTop: 24 }}>Status values</h3>
              <div className="help-legend">
                {STATUSES.map((s) => (
                  <div key={s.status} className="help-legend-item"
                       style={{ background: s.bg, borderLeft: `3px solid ${s.colour}` }}>
                    <span className="help-legend-item__label" style={{ color: s.colour }}>
                      {s.status}
                    </span>
                    <span className="help-legend-item__desc">{s.desc}</span>
                  </div>
                ))}
              </div>

              <h3 className="help-section__sub" style={{ marginTop: 24 }}>Check types</h3>
              <p className="help-section__body">
                Each rule may involve one or more check types. The check types performed are
                shown as tags on each finding card.
              </p>
              <div className="help-checks">
                {CHECK_TYPES.map((c) => (
                  <div key={c.type} className="help-check-item">
                    <span className="help-check-item__badge">{c.type}</span>
                    <div>
                      <span className="help-check-item__name">{c.name}</span>
                      <span className="help-check-item__desc"> — {c.desc}</span>
                    </div>
                  </div>
                ))}
              </div>

              <h3 className="help-section__sub" style={{ marginTop: 24 }}>Reasoning Flags</h3>
              <p className="help-section__body">
                Reasoning Flags are cross-module observations — arithmetic discrepancies,
                conflicting figures between sections, or logical inconsistencies that require
                priority legal review. They appear in the <em>Flags</em> tab in the sidebar.
              </p>
            </section>
          )}

          {activeSection === 'rulebook' && (
            <section className="help-section">
              <h2 className="help-section__title">Rulebook</h2>

              <h3 className="help-section__sub">Edith Compliance Rulebook</h3>
              <p className="help-section__body">
                The rulebook embedded below is a structured compliance guide developed by
                Edith based on the HKEX guidelines for the Chapter 18C Meaningful
                Investment requirement. It is <strong>not</strong> an official HKEX
                publication — it is an internal reference tool created specifically to
                structure the AI analysis across all 10 modules.
              </p>
              <p className="help-section__body">
                The AI analysis engine uses this Edith rulebook as its primary system
                prompt context when evaluating prospectus disclosures. No other rulebook
                document is sent to the API.
              </p>
              <a
                href="/rulebook_v2.pdf"
                target="_blank"
                rel="noopener noreferrer"
                className="help-rulebook-btn"
              >
                Open Edith Rulebook PDF ↗
              </a>
              <div className="help-rulebook-embed">
                <iframe
                  src="/rulebook_v2.pdf"
                  title="Edith Meaningful Investment Compliance Rulebook"
                  className="help-rulebook-iframe"
                />
              </div>

              <h3 className="help-section__sub" style={{ marginTop: 28 }}>Official HKEX Reference</h3>
              <p className="help-section__body">
                The official regulatory source is Chapter 18C of the HKEX Main Board Listing
                Rules and the{' '}
                <em>Guide for New Listing Applicants</em> — specifically{' '}
                <strong>Section 2.5 (Specialist Technology Companies)</strong>, which sets out
                the Specialist Technology Industry definitions, minimum market capitalisation
                requirements, R&D expenditure thresholds, and the Meaningful Investment
                framework. This is the official HKEX document on which the Edith rulebook
                is based.
              </p>
            </section>
          )}

        </div>
      </div>
    </div>
  );
};
