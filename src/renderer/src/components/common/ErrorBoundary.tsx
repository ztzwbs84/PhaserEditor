import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

export class ErrorBoundary extends Component<{ children: ReactNode; name: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Panel ${this.props.name} failed`, error, info)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="panel-error" role="alert">
        <AlertTriangle size={24} />
        <strong>{this.props.name} could not be displayed</strong>
        <span>{this.state.error.message}</span>
        <button className="button" onClick={() => this.setState({ error: null })}><RotateCcw size={15} />Retry</button>
      </div>
    )
  }
}
