import { Component, type ReactNode } from 'react'

/** Shows a recoverable error screen instead of a blank page if a view crashes. Your save is untouched. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Protocol crashed:', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto max-w-lg space-y-3 p-6">
        <h1 className="text-lg font-bold">Something broke on this screen</h1>
        <p className="text-sm text-dim">Your saved progress is safe. Reloading usually fixes it; if it keeps happening, please report what you tapped.</p>
        <pre className="overflow-x-auto rounded-lg border border-line bg-panel p-2 text-xs text-bad">{this.state.error.message}</pre>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={() => location.reload()}>
            Reload
          </button>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Try to continue
          </button>
        </div>
      </div>
    )
  }
}
