# dsh-image-gen

**Authors:** Adithya N Raj & Gemini

Custom multi-provider image generation, editing, and interactive canvas studio plugin for **DeepSeek Harness (DSH)**, with native support for custom `/v1/images/generations` and `/v1/images/edits` endpoints.

---

## Features

- **Custom `/v1/images/generations` Endpoint Support**: Configure any OpenAI-compatible gateway, reverse proxy, or self-hosted server (vLLM, LiteLLM, OneAPI, NewAPI, LocalAI, SGLang) using either the `/v1` base URL or the full `/v1/images/generations` endpoint URL.
- **Multiple Named Relay Channels**: Add and switch between multiple independent OpenAI-compatible endpoints, each with its own API key, base URL, model catalog, quality tiers, and extra JSON payload fields.
- **Multi-Provider Support**:
  - OpenAI & OpenAI-Compatible Relays (`/v1/images/generations`, `/v1/images/edits`)
  - Google Gemini (`interactions` and native `generateContent`)
  - ByteDance Seedream (Volcengine Ark)
  - Aliyun DashScope (Qwen Image / Wanx)
  - xAI Grok Imagine
  - Zhipu GLM-Image
  - Local ComfyUI (custom API workflow JSONs)
  - Subscription Accounts (ChatGPT, Grok, Google Antigravity)
- **Agent Tools**:
  - `generate_image`: Single text-to-image generation.
  - `generate_images`: Sequential batch generation (up to 10 prompts per call).
  - `edit_image`: Image-to-image editing, restyling, and multi-reference composition.
  - `find_inspiration`: Prompt template search across bundled style and layout catalogs.
  - `canvas_state` & `view_canvas`: Live infinite canvas inspection and sketch-to-image workflows.
- **Interactive Workbench**: Gallery, Studio, Multi-Model Comparison, and tldraw Infinite Canvas directly inside the DSH Web GUI.

---

## Custom `/v1/images/generations` Configuration

1. Open **Plugins → Installed → dsh-image-gen** in the DSH Web GUI.
2. Expand **OpenAI Compatible (relay)** (or click **+** to add a named channel).
3. Enter your **API Key** and **Endpoint / Base URL**:
   - Full endpoint URL: `https://your-host.example.com/v1/images/generations`
   - Or base URL: `https://your-host.example.com/v1`
4. Enter your model name (or click **Fetch models**), configure any custom resolution table or extra JSON body fields, and click **Save**.

---

## Development & Build

```bash
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
```

### Local Profile Linking

```bash
dsh plugin --profile desktop add link:B:/Research/dsh-image-gen
dsh plugin --profile web add link:B:/Research/dsh-image-gen
```

---

## License

Apache-2.0 — Copyright © 2026 Adithya N Raj & Gemini.
