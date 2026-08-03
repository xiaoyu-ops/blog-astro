# Product

## Register

brand

## Users

The primary user is the site's owner, who maintains a personal research and project homepage. Public visitors use it to understand current work without gaining access to private infrastructure. The LAB-2 status route is a product-like monitoring surface inside this broader personal brand site.

## Product Purpose

The site presents writing, projects, and current work in a trustworthy, personal form. The LAB-2 status surface answers whether the server, telemetry chain, experiment, and resources are healthy while preserving operational privacy. Success means public claims match live sources and stale data is never presented as current.

## Brand Personality

Quiet, precise, personal. The interface should feel considered and human, with technical evidence available when it matters and little decorative noise.

## Anti-references

- Generic SaaS dashboards with oversized metric cards, gradients, and decorative charts.
- Public Grafana-style operations consoles that expose internal implementation detail.
- Status pages that collapse server health, workload activity, and experiment success into one ambiguous color.
- Interfaces that invent progress, freshness, or deadlines from incomplete data.

## Design Principles

1. Evidence before confidence: every live claim must come from a named, current source.
2. Public summary, private depth: show only what a visitor needs; keep operational detail behind trusted access.
3. Separate meanings: server, telemetry, experiment, and resource states remain independently legible.
4. Quiet hierarchy: prioritize the current outcome and exception, then reveal supporting evidence.
5. Preserve continuity: new monitoring UI must feel native to the existing personal homepage.

## Accessibility & Inclusion

Use semantic text in addition to color, preserve keyboard and mobile access, support bilingual Chinese and English copy, and respect `prefers-reduced-motion`. Unknown and stale values must remain explicit rather than disappearing.
