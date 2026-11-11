import { ErrorBoundary } from "./features/app/chrome";
import { AppShell } from "./features/app/AppShell";
import { ControlPlaneGate } from "./features/auth/ControlPlaneGate";

export default function App() {
  return (
    <ErrorBoundary>
      <ControlPlaneGate>
        <AppShell />
      </ControlPlaneGate>
    </ErrorBoundary>
  );
}
