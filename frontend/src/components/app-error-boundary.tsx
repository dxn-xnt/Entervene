import { Component, type ReactNode } from "react";
import StatusPage from "@/pages/status-page";

export default class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: any) {
    console.error("AppErrorBoundary caught error:", error, info);
  }
  render() {
    return this.state.hasError ? <StatusPage /> : this.props.children;
  }
}
