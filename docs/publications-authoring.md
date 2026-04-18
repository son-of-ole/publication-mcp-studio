# Publications Authoring Guide

The publications system remains markdown-first so the same source can be:

- rendered for humans as a polished article
- copied directly from the UI
- fetched as raw markdown from `/publications/<slug>/raw`
- prepared later by an AI formatting assistant without losing the source text

## Frontmatter Metadata

The editor now writes structured frontmatter at the top of the markdown document. Common fields include:

```md
---
title: "Model Stability Under SICWA"
publicationLabel: "Lab Report"
subtitle: "A markdown-first interactive research publication"
abstract: "We evaluate..."
authors:
  - "Gordon Olson"
authorProfiles:
  - "Gordon Olson | email=gordon@sonofol.org | social=https://linkedin.com/in/gordon-sonofol"
affiliations:
  - "Research Publishing Team"
tags:
  - psychometrics
  - llm
journal: "Publication MCP Studio Reports"
doi: "10.xxxx/example"
repositoryUrl: "https://github.com/owner/repo"
repositoryLabel: "GitHub Repository"
published: "2026-04-09"
revised: "2026-04-10"
canonicalUrl: "https://example.com/publications/model-stability"
heroImage: "https://example.com/hero.png"
heroVideo: "https://example.com/hero.mp4"
heroPoster: "https://example.com/hero-poster.png"
heroCaption: "Hero media caption"
---
```

`publicationLabel` controls the small uppercase line above the publication title. If you omit it, the public view falls back to `Scientific Publication`.

`authorProfiles` is optional and lets you attach clickable links next to each author. Use one line per author in either of these shapes:

```md
authorProfiles:
  - "Gordon Olson | email=gordon@sonofol.org | social=https://linkedin.com/in/gordon-sonofol | orcid=https://orcid.org/0000-0000-0000-0000 | url=https://example.com"
  - "Jane Doe | github=jane-lab | url=example.com/jane"
```

Or, if the order matches the `authors` list, you can omit the name and let the system pair profiles by position:

```md
authorProfiles:
  - "email=gordon@sonofol.org | social=https://linkedin.com/in/gordon-sonofol"
  - "orcid=0000-0000-0000-0000 | github=jane-lab"
```

Supported keys are:

- `name`
- `email`
- `orcid`
- `social`
- `github`
- `url`

Notes:

- `github=jane-lab` expands to `https://github.com/jane-lab`
- `orcid=0000-0000-0000-0000` expands to `https://orcid.org/0000-0000-0000-0000`
- `url=example.com/jane` expands to `https://example.com/jane`

`repositoryUrl` and `repositoryLabel` let you surface a GitHub or data repository link in the publication header and source-access area.

The editor also preserves extra custom frontmatter keys if you need additional metadata.

## Core Markdown

Standard markdown works as expected:

- headings
- paragraphs
- emphasis
- lists
- tables
- blockquotes
- fenced code blocks
- links
- images

Inline math is supported with `$...$`.

Display math is supported with:

```md
$$
\alpha = \frac{k}{k-1}\left(1 - \frac{\sum \sigma_i^2}{\sigma_T^2}\right)
$$
```

## Legacy Layout Helpers

These existing shortcuts still render:

- `[center]`
- `[right]`
- `[justify]`
- `[dropcap]`
- `[gallery]`
- image configs like `w=640` and `float=right`

## Scientific Blocks

Use these blocks for richer publication content.

### Figure

```md
::figure{src="https://example.com/figure.png" alt="Reliability chart" caption="Reliability across runs"}
```

### Video

```md
::video{src="https://example.com/demo.mp4" poster="https://example.com/poster.png" caption="Walkthrough of the experiment"}
```

### Interactive

```md
::interactive{src="https://example.com/embed" title="Interactive dashboard" height=560}
```

### Chart

Render a publication-grade chart directly from markdown attributes.

```md
::chart{type="line" title="Reliability by Condition" labels="Baseline|Calibrated|Replicated" series="Run A:0.81,0.88,0.91; Run B:0.78,0.85,0.89" yLabel="Score" min="0" max="1"}
```

Supported chart types:

- `bar`
- `line`
- `radar`

### Dataset

Render a styled dataset table without dropping into raw HTML.

```md
::dataset{title="Evaluation Slice" columns="Metric|Mean|StdErr" rows="Accuracy|0.91|0.02; Recall|0.88|0.03; F1|0.89|0.02" source="Held-out set"}
```

### Notebook

Use this for Jupyter, Colab, Observable, or other notebook-style embeds.

```md
::notebook{title="Exploration Notebook" src="https://example.com/notebook" runtime="Python" kernel="Jupyter" summary="Interactive exploratory notebook for this experiment." height="620"}
```

### Lean / Proof

Use `::lean` or `::proof` for formal artifacts. Provide either an embed `src` or inline code with escaped newlines.

```md
::lean{title="Stability Theorem" theorem="stability_bound" status="checked" summary="Machine-checked statement for the main bound." code="theorem stability_bound : True := by\n  trivial"}
```

```md
::proof{title="Mechanized Proof Viewer" src="https://example.com/proof" system="Lean 4" theorem="stability_bound" status="checked"}
```

### Download

```md
::download{href="https://example.com/paper.pdf" label="Open PDF"}
```

### Citation

Inline citations are markdown-first and link back to the generated references section.

```md
This finding reproduces prior work [@smith2024].

Multiple sources can be cited together [@smith2024; @doe2023].
```

### Reference Entry

Structured references stay in markdown and are compiled into publication-style output.

```md
::reference{id="smith2024" title="Model Stability Under SICWA" authors="Smith, John; Doe, Jane" journal="Journal of Applied Evaluation" year="2024" doi="10.xxxx/example" url="https://example.com/paper"}
```

Required fields:

- `id`
- `title`

Common optional fields:

- `authors`
- `type`
- `journal`
- `publisher`
- `year`
- `month`
- `day`
- `doi`
- `url`
- `volume`
- `issue`
- `pages`
- `edition`
- `note`

### Bibliography

Place the bibliography wherever you want it to appear, or omit the block and the renderer will append one automatically.

```md
::bibliography{title="References"}
```

### Callout

```md
:::note{title="Key point"}
This result stayed stable across repeated runs.
:::
```

Supported callout tones:

- `note`
- `tip`
- `warning`
- `result`
- `experiment`

## Next Phases

Planned follow-up work for the publication stack:

1. Add AI-assisted authoring workflows that rewrite or scaffold publication blocks without replacing the markdown source of truth.
2. Introduce richer markdown-native editing affordances beyond the current structured textarea workspace.
3. Add export helpers for BibTeX, CSL-JSON, and publication packets.
4. Add publication navigation features such as section outlines, figure indexes, and cross-references.
