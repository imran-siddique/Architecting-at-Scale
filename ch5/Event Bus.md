## Implementing the Event Bus: Cross-App Communication Without Coupling

When micro-apps need to coordinate, cart updates, authentication changes, notification arrivals, they communicate through an Event Bus. The Event Bus is a publish/subscribe mechanism owned by the Shell that allows micro-apps to emit and listen for domain events without importing each other’s code.

The critical constraint: events carry data, not behavior. A micro-app publishes a fact (“item added to cart, new count: 3”). It never publishes an instruction (“re-render your cart badge”). The consuming micro-app decides how and whether to react.

```
// Shell: Event Bus implementation (thin wrapper over CustomEvent)
// File: shell/src/event-bus.ts

type EventPayload = Record<string, unknown>;

const EVENT_BUS_PREFIX = 'shopflow:';

export const EventBus = {
  publish(eventName: string, payload: EventPayload): void {
    window.dispatchEvent(
      new CustomEvent(`${EVENT_BUS_PREFIX}${eventName}`, {
        detail: Object.freeze({ ...payload, _timestamp: Date.now() }),
      })
    );
  },

  subscribe(
    eventName: string,
    handler: (payload: EventPayload) => void
  ): () => void {
    const listener = (event: Event) => {
      handler((event as CustomEvent).detail);
    };
    window.addEventListener(`${EVENT_BUS_PREFIX}${eventName}`, listener);
    return () => window.removeEventListener(`${EVENT_BUS_PREFIX}${eventName}`, listener);
  },
};
// Checkout Micro-App: Publishing a cart update
// File: checkout/src/cart-service.ts

import { EventBus } from '@shopflow/shell-sdk';

export async function addToCart(productId: string): Promise<void> {
  const response = await fetch('/api/cart/items', {
    method: 'POST',
    body: JSON.stringify({ productId }),
  });
  const cart = await response.json();

  // Publish the fact - not an instruction
  EventBus.publish('cart:updated', {
    itemCount: cart.totalItems,
    subtotal: cart.subtotal,
  });
}
// Navigation Micro-App: Reacting to the cart event
// File: shell/src/components/CartBadge.tsx

import { useEffect, useState } from 'react';
import { EventBus } from '@shopflow/shell-sdk';

export function CartBadge() {
  const [count, setCount] = useState<number>(() => {
    // Fallback: last known value from sessionStorage
    const cached = sessionStorage.getItem('shopflow:cart:count');
    return cached ? parseInt(cached, 10) : 0;
  });

  useEffect(() => {
    const unsubscribe = EventBus.subscribe('cart:updated', (payload) => {
      const newCount = payload.itemCount as number;
      setCount(newCount);
      sessionStorage.setItem('shopflow:cart:count', String(newCount));
    });
    return unsubscribe;
  }, []);

  return count > 0 ? <span className="badge">{count}</span> : null;
}
```

Notice the fallback pattern. The CartBadge initializes from sessionStorage, not from a global store. If the Checkout micro-app has not yet loaded (or has crashed), the badge still shows the last known count. This is the State Ownership Rule in practice: the shared service (Checkout’s cart) owns the authoritative value, but consumers maintain their own degraded fallback.
