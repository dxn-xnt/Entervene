import { Component, type ReactNode } from "react";
import StatusPage from "@/pages/StatusPage";

export default class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    return this.state.hasError ? <StatusPage /> : this.props.children;
  }
}
