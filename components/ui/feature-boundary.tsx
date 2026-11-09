"use client";
import { Button } from "@/components/ui/button";
import { Component,type ReactNode } from "react";

/** Keep navigation usable if a deferred feature cannot be downloaded or rendered. */
export class FeatureBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="app-feature-error" role="alert">
      <h2>This part of the dashboard couldn’t load</h2>
      <p>Reload the app to try again. You’ll need to sign in again.</p>
      <Button onClick={() => window.location.reload()}>Reload app</Button>
    </section>;
  }
}
