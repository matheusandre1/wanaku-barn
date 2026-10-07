import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DebuggerPage } from "./DebuggerPage";
import "./styles.scss";
interface Disposable {
  dispose(): void;
}
export interface PluginHost {
  navigation: {
    add(entry: {
      id: string;
      label: string;
      route: string;
      section?: string;
      order?: number;
    }): Disposable;
  };
  pages: {
    register(page: {
      route: string;
      mount: (container: HTMLElement) => Disposable;
    }): Disposable;
  };
}
const disposables: Disposable[] = [];
const roots = new Set<Root>();
export function activate(host: PluginHost): void {
  disposables.push(
    host.navigation.add({
      id: "wanaku-debugger",
      label: "Debugger",
      route: "/wanaku/debugger",
      section: "Developer",
      order: 120,
    }),
  );
  disposables.push(
    host.pages.register({
      route: "/wanaku/debugger",
      mount(container) {
        const root = createRoot(container);
        roots.add(root);
        root.render(
          <StrictMode>
            <DebuggerPage />
          </StrictMode>,
        );
        return {
          dispose() {
            if (roots.delete(root)) root.unmount();
          },
        };
      },
    }),
  );
}
export function deactivate(): void {
  for (const disposable of disposables.splice(0)) disposable.dispose();
  for (const root of roots) root.unmount();
  roots.clear();
}
