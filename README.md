<p align="center">
  <img src="public/favicon.svg" alt="wordcloud.download icon" width="88" />
</p>

<h1 align="center">wordcloud.download</h1>

<p align="center">
  <a href="https://github.com/dytsou/wordcloud/actions/workflows/ci.yml">
    <img alt="CI status" src="https://github.com/dytsou/wordcloud/actions/workflows/ci.yml/badge.svg?branch=main" />
  </a>
  <a href="https://pnpm.io/">
    <img alt="pnpm 11.25.0" src="https://img.shields.io/badge/pnpm-11.25.0-F69220?logo=pnpm&amp;logoColor=fff" />
  </a>
  <a href="https://www.typescriptlang.org/">
    <img alt="TypeScript 6.0.3" src="https://img.shields.io/badge/TypeScript-6.0.3-3178C6?logo=typescript&amp;logoColor=white" />
  </a>
  <a href="https://developers.cloudflare.com/workers/">
    <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&amp;logoColor=white" />
  </a>
</p>

wordcloud.download is a local-first word-cloud generator for individual creators. Paste multilingual text, preview the tokenizer output, tune the visual treatment, and share a reproducible V link without uploading the source text.

Turn text into a multilingual word cloud. Paste your text, choose which words to include, shape the design, then download it or share a link. The editor analyzes your text in your browser.

## Quick Start

With Node.js and pnpm 11 installed, start the editor locally:

```sh
pnpm install
pnpm run dev
```

Open the local address printed by Vite, then follow the four editor steps:

1. **Add your text.** Paste or type text on the Source step. Your latest draft stays in this browser so you can refresh without losing it.
2. **Review the words.** On the Words step, choose the language used to split text and check the preview. You can ignore letter case, include numbers or symbols, remove common words, keep a phrase together, or split and merge terms.
3. **Style the cloud.** Choose a built-in shape or upload an image as a shape, then adjust the font, colors, word sizes, rotation, spacing, and canvas. Confirm the detected foreground before applying it; for photos, mark the subject and background, refine the mask with keep/remove brushes, and review the preview. Text and decorative fill stay clipped to the confirmed foreground. Larger words represent terms that occur more often.
4. **Download or share.** Download a PNG for an image or an SVG for a scalable graphic. Create a V link to share or remix the design. You can also save or open a `.wc` snapshot file.

The language menu in the header changes the editor labels. Choose the text's analysis language separately on the Words step.

## Text, links, and privacy

Text entered in the editor is analyzed and laid out in your browser. The app keeps the latest source draft in this browser's local storage to restore it after a refresh. Starting a new cloud clears that cached draft.

V links contain the processed words, their counts and ranks, and the cloud's appearance and layout. For an uploaded shape, they also contain the confirmed foreground mask, its representative colors, and the saved arrangement so recipients can edit and reflow it. The original source photo is not included. Links and `.wc` files can disclose the word list and the retained shape image, so share them only when that content is okay to disclose. A `.wc` snapshot contains the same processed cloud data; use it when a link is too long or when you want a file to reopen later.

## Limits

The editor accepts up to 1 MiB of text and 500 unique terms. Uploaded shapes are reduced to a 192 × 192 foreground mask with up to 96 representative colors. Source images are decoded and processed in the browser; the original photo is not included in a snapshot. You can change the derived word list, compare actual reflow attempts, and adopt a result. Some terms may not fit the selected layout; they remain in the ranked word list with a reason.

## For developers

- [Contributing guide](CONTRIBUTING.md)
- [MCP and automation](docs/mcp.md)
- [Local development and deployment](docs/development.md)
- [OpenAPI contract](openapi.yaml)
