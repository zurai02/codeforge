// In-browser language model via WebLLM (WebGPU). Free, no API key, no server: the model
// weights download once from a public CDN, are cached by the browser, and run on the
// visitor's own GPU. The import is lazy so the app still works (docs mode) if it fails.

const WEBLLM_URL = 'https://esm.run/@mlc-ai/web-llm@0.2.79';

export const MODELS = [
  { key: 'Qwen2.5-Coder-0.5B-Instruct', label: 'Tiny: 0.5B (about 1 GB, phones and old GPUs)' },
  { key: 'Qwen2.5-Coder-1.5B-Instruct', label: 'Fast: 1.5B (about 1.6 GB)' },
  { key: 'Qwen2.5-Coder-3B-Instruct', label: 'Balanced: 3B (about 2.5 GB)' },
  { key: 'Qwen2.5-Coder-7B-Instruct', label: 'Best: 7B (about 5 GB, needs a strong GPU)' },
];

export async function probeGPU() {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return { ok: false, f16: false, reason: 'This browser has no WebGPU. Use a recent Chrome or Edge to run the AI model. Docs mode still works.' };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, f16: false, reason: 'No usable GPU was found. Docs mode still works.' };
    return { ok: true, f16: adapter.features.has('shader-f16'), reason: '' };
  } catch (e) {
    return { ok: false, f16: false, reason: 'WebGPU failed to start: ' + (e && e.message ? e.message : e) };
  }
}

export class Brain {
  constructor() {
    this.engine = null;
    this.label = '';
    this.loading = false;
    this.lastFinish = null;
  }

  get ready() {
    return !!this.engine;
  }

  async load({ modelKey, f16, custom, onProgress }) {
    if (this.loading || this.engine) return;
    this.loading = true;
    try {
      const webllm = await import(/* @vite-ignore */ WEBLLM_URL);
      let modelId = modelKey + (f16 ? '-q4f16_1-MLC' : '-q4f32_1-MLC');
      let appConfig;
      if (custom && custom.id && custom.model && custom.lib) {
        // Your own fine-tuned model, converted to MLC format (see README).
        appConfig = {
          ...webllm.prebuiltAppConfig,
          model_list: [
            ...webllm.prebuiltAppConfig.model_list,
            { model: custom.model, model_id: custom.id, model_lib: custom.lib },
          ],
        };
        modelId = custom.id;
      } else {
        const ids = webllm.prebuiltAppConfig.model_list.map((m) => m.model_id);
        if (!ids.includes(modelId)) {
          const alt = ids.find((id) => /Coder-1\.5B.*q4f16/.test(id)) || ids.find((id) => /Coder/.test(id));
          if (!alt) throw new Error('No coding model is available in this WebLLM version.');
          modelId = alt;
        }
      }
      this.engine = await webllm.CreateMLCEngine(
        modelId,
        { appConfig, initProgressCallback: (r) => onProgress && onProgress(r.progress || 0, r.text || '') }
      );
      this.label = modelId.replace(/-MLC$/, '').replace(/-q4f(16|32)_1$/, '');
    } catch (e) {
      this.engine = null;
      throw e;
    } finally {
      this.loading = false;
    }
  }

  async *stream(messages, { temperature = 0.2, maxTokens = 1024, signal } = {}) {
    if (!this.engine) throw new Error('The model is not loaded.');
    this.lastFinish = null;
    const stop = () => {
      try {
        if (typeof this.engine.interruptGenerate === 'function') this.engine.interruptGenerate();
      } catch {
        /* nothing to interrupt */
      }
    };
    if (signal) signal.addEventListener('abort', stop);
    try {
      const chunks = await this.engine.chat.completions.create({
        messages,
        stream: true,
        temperature,
        top_p: 0.9,
        max_tokens: maxTokens,
      });
      for await (const ch of chunks) {
        const c = ch.choices && ch.choices[0];
        if (c && c.delta && c.delta.content) yield c.delta.content;
        if (c && c.finish_reason) this.lastFinish = c.finish_reason;
        if (signal && signal.aborted) break;
      }
    } finally {
      if (signal) signal.removeEventListener('abort', stop);
    }
  }
}
