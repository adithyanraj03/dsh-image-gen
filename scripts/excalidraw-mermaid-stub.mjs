/**
 * Build-time stub for @excalidraw/mermaid-to-excalidraw.
 *
 * Excalidraw lazy-loads that package (and the whole mermaid renderer, several
 * MB) for its AI "text to diagram" dialog and for pasting mermaid source.
 * The workbench canvas disables AI features (aiEnabled=false), so the plugin
 * aliases the package to this stub to keep the single-file client bundle
 * lean. The paste path catches the rejection and falls back to plain text;
 * the dialog is unreachable with AI features off.
 */
export async function parseMermaidToExcalidraw() {
  throw new Error('mermaid-to-excalidraw is not bundled in dsh-image-gen (AI diagram features are disabled)')
}
