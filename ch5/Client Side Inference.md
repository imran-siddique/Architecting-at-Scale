# The AI Moment: Client-Side Inference: A Reality Check

The AI Moment for this chapter is client-side ML inference, using TensorFlow.js for image cropping or form validation. The honest assessment: **client-side ML inference remains predominantly demo-ware.** A TensorFlow.js model on a mid-range mobile device consumes 200–500ms of main thread time per inference. On the exact devices where we are reducing blocking, we would be adding a new computational burden.

| Use Case | Client-Side Inference? | Recommendation |
|----------|----------------------|----------------|
| Image cropping/resizing before upload | Viable with constraints | Use the Canvas API or OffscreenCanvas in a Web Worker, not a full ML model. |
| Form validation (address autocomplete, typo detection) | Over-engineering | A server-side API call with <100ms latency is simpler, more accurate, and more maintainable. |
| Product visual search (find similar from photo) | Server-side | The model size and inference cost make this a server workload. |
| Personalized UI layout (predicting user preferences) | Future-viable | Lightweight models (<5MB) with WebNN API support could enable this. Not production-ready today. |

> **The Client Inference Reality Rule:** Do not ship ML models to the browser unless offline functionality is required, privacy prohibits server calls, or latency must be below 10ms with a model under 2MB. Otherwise, server-side inference is faster, more reliable, and battery-friendly.

This landscape is evolving, WebNN, WebGPU, and quantized models may shift this within 12–18 months. But always measure on your actual user devices: a model running in 50ms on a MacBook M3 runs in 800ms on a budget Android phone. **The latter is your performance budget.**
