import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("MyHSK could not render", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="app-error-screen" role="alert">
      <div className="app-error-card">
        <AlertTriangle size={30}/>
        <span className="eyebrow">SOMETHING WENT WRONG</span>
        <h1>Let’s reopen the lesson.</h1>
        <p>Your learning progress is stored on this device and has not been removed.</p>
        <button className="primary-button" onClick={() => window.location.reload()}><RotateCcw size={17}/> Reload MyHSK</button>
      </div>
    </main>;
  }
}
