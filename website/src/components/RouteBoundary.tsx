import { Component, type ReactNode } from 'react'
import { Button } from './ui/button.tsx'
import { RouteFocus } from './RouteFocus.tsx'

/** Keep site navigation available when a route fails to download or render. */
export class RouteBoundary extends Component<{ children: ReactNode, onError: () => void, resetKey: string }, { failed: boolean, resetKey: string }> {
  state = { failed: false, resetKey: this.props.resetKey }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { resetKey: string }) {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey }
  }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch() { this.props.onError() }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="markdown docs-article">
        <h1>Page could not load</h1>
        <p>Reload this page to try again, or use the navigation to open another page.</p>
        <Button onClick={() => window.location.reload()}>Reload page</Button>
        <RouteFocus />
      </main>
    )
  }
}
