# BeadCraftr

BeadCraftr is a browser-first fuse-bead pattern maker. Upload an image, choose
your board and bead palette, then refine and export a pattern without uploading
the image to an application server.

## Local development

Node.js 22 or newer is required.

```bash
npm install
npm run dev
```

`npm run build` creates a static export in `dist/client/`, and `npm test` verifies that
export along with the project checks.

## GitHub Pages deployment

The repository includes [a GitHub Pages workflow](.github/workflows/deploy-pages.yml).
After pushing it to the default branch, enable Pages once in the repository:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. Push to `main`, or run **Deploy GitHub Pages** from the repository’s
   **Actions** tab.

The workflow uses the repository’s Pages base path automatically, so this
project publishes at `https://mbwood33.github.io/beadcraftr/`.

## Key commands

- `npm run dev` — local development server
- `npm run build` — static production export to `dist/client/`
- `npm test` — build and repository checks
- `npm run lint` — lint source files
