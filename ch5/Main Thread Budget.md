# Breaking Up Long Tasks: The Main Thread Budget

Regardless of device tier, the browser's main thread is a single-threaded resource. Any task that occupies the main thread for more than **50 milliseconds** is classified as a "Long Task" by the W3C Performance Observer API. Long Tasks block input handling—the user clicks a button and nothing happens because the browser is busy executing JavaScript.

ShopFlow's 2.8-second main thread blocking time means the UI is unresponsive for nearly three full seconds during initial load. This is the aggregate of multiple Long Tasks: parsing the bundle, evaluating module initializations, rendering the initial component tree, and executing third-party scripts.

The mitigation strategies operate at different architectural levels:

---

## 1. Code Splitting (Architecture Level)

The micro-frontend decomposition from Section 1 is the highest-leverage fix. Instead of parsing one 5.2MB bundle, the browser loads a **150KB Shell** and lazily loads the active micro-app (400–600KB). The irrelevant micro-apps never touch the main thread.

## 2. Deferred Hydration (Rendering Level)

Not every interactive element needs JavaScript immediately. The "Add to Cart" button needs to work instantly. The "Recently Viewed" carousel at the bottom of the page does not. **Selective hydration** (React 18's Suspense boundaries) and **Islands Architecture** (Astro-style) allow the server-rendered HTML to be interactive where it matters and static where it does not.

## 3. Web Workers (Computation Level)

Heavy client-side computation—data transformation, search indexing, analytics event batching—can be moved off the main thread entirely. A Web Worker runs in a separate thread and communicates with the main thread via `postMessage`. The caveat: Web Workers have no DOM access.

## 4. requestIdleCallback (Scheduling Level)

Non-critical work—prefetching the next page, initializing a chat widget, loading below-the-fold images—should be deferred to idle periods using `requestIdleCallback` or the newer `scheduler.yield()` API.

```typescript
// Deferring non-critical initialization to idle time
// File: shell/src/deferred-init.ts

const NON_CRITICAL_TASKS = [
  () => import('./analytics').then((m) => m.init()),
  () => import('./chat-widget').then((m) => m.mount()),
  () => import('./prefetch-engine').then((m) => m.start()),
];

function scheduleNonCriticalWork(): void {
  let taskIndex = 0;

  function runNextTask(deadline: IdleDeadline): void {
    while (taskIndex < NON_CRITICAL_TASKS.length && deadline.timeRemaining() > 10) {
      NON_CRITICAL_TASKS[taskIndex]();
      taskIndex++;
    }
    if (taskIndex < NON_CRITICAL_TASKS.length) {
      requestIdleCallback(runNextTask);
    }
  }

  requestIdleCallback(runNextTask);
}

// Call after critical path rendering is complete
scheduleNonCriticalWork();
```

---

> **The 50ms Rule:** Every JavaScript execution on the main thread that exceeds 50ms is stealing responsiveness from the user. Use Chrome DevTools' Performance panel or the `PerformanceObserver` Long Task API to identify and break up these tasks. This is not optimization—it is a **correctness requirement** for interactive applications.
