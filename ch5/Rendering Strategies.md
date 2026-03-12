# The Three Rendering Strategies

| Strategy | Where HTML is Built | When It is Built | Data Freshness | Server Cost | Best For |
|----------|-------------------|-----------------|----------------|-------------|----------|
| **CSR** (Client-Side Rendering) | Browser | On every page visit, per user | Real-time (fetches live data) | Low (static file hosting) | Authenticated dashboards, admin panels, highly interactive tools where SEO is irrelevant |
| **SSR** (Server-Side Rendering) | Server | On every request | Fresh per request | High (server compute per request) | Personalized pages, checkout flows, content requiring per-user computation |
| **SSG** (Static Site Generation) | Build server | At build/deploy time | Stale until next build | Minimal (CDN serves static files) | Product catalogs, marketing pages, documentation, infrequently changing content |
| **ISR** (Incremental Static Regeneration) | Build server + on-demand revalidation | At build time, then revalidated in background | Stale-while-revalidate (configurable TTL) | Medium (CDN + periodic origin compute) | Large catalogs with moderate update frequency |
