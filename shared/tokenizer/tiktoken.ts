// The native Worker loads the same pinned WASM through its fixed offline resource scheme.
import { init, Tiktoken } from '@dqbd/tiktoken/lite/init';
await init(imports => WebAssembly.instantiateStreaming(fetch('weavelet-tokenizer://bundle/tiktoken_bg.wasm'), imports));
export { Tiktoken };
