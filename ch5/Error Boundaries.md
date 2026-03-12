## Implementing Error Boundaries: Component-Level Isolation

React’s Error Boundary API is the foundation of component-level fault isolation. An Error Boundary is a component that catches JavaScript errors in its child component tree, logs the error, and renders a fallback UI instead of crashing the entire application.

The architectural mistake most teams make is placing a single Error Boundary at the application root. This catches everything—and displays a generic “Something went wrong” page that is functionally equivalent to a crash. The user loses all context and cannot complete any task.

The correct pattern is granular Error Boundaries at the micro-app and widget level:

```
// Shell: Top-level Error Boundary wrapping each micro-app slot
// File: shell/src/components/MicroAppSlot.tsx

import { Component, ReactNode } from 'react';
import { telemetry } from '@shopflow/shell-sdk';

interface Props {
  appName: string;
  fallback: ReactNode;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class MicroAppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    telemetry.trackException({
      error,
      properties: {
        microApp: this.props.appName,
        componentStack: info.componentStack ?? 'unknown',
        severity: 'micro-app-crash',
      },
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
// Shell: Composing the page with isolated micro-app slots
// File: shell/src/pages/ProductPage.tsx

import { MicroAppErrorBoundary } from '../components/MicroAppSlot';
import { Suspense, lazy } from 'react';

const ProductDetail = lazy(() => import('checkout/ProductDetail'));
const Recommendations = lazy(() => import('search/Recommendations'));
const Reviews = lazy(() => import('profile/Reviews'));

export function ProductPage() {
  return (
    <main>
      {/* Critical Path - fallback is a full error page */}
      <MicroAppErrorBoundary appName="product-detail" fallback={<CriticalPathError />}>
        <Suspense fallback={<ProductSkeleton />}>
          <ProductDetail />
        </Suspense>
      </MicroAppErrorBoundary>

      {/* Enhancement - fallback is silent removal */}
      <MicroAppErrorBoundary appName="recommendations" fallback={null}>
        <Suspense fallback={<RecommendationsSkeleton />}>
          <Recommendations />
        </Suspense>
      </MicroAppErrorBoundary>

      {/* Enhancement - fallback is silent removal */}
      <MicroAppErrorBoundary appName="reviews" fallback={null}>
        <Suspense fallback={<ReviewsSkeleton />}>
          <Reviews />
        </Suspense>
      </MicroAppErrorBoundary>
    </main>
  );
}
```

Notice the asymmetry. The critical path component (ProductDetail) has a visible error fallback—because if the product detail itself cannot render, the user needs to know. The enhancement components (Recommendations, Reviews) have a null fallback—they silently disappear. The user never sees an error message for a widget they did not ask for. The page simply has fewer sections, and the core task (viewing the product and adding to cart) is unaffected.

