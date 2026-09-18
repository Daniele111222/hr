import { AppProviders } from "./AppProviders.tsx";
import { AppRouter } from "./AppRouter.tsx";

export default function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
