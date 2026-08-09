import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

// 错误边界：捕获子组件渲染错误，避免整个应用黑屏
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex items-center justify-center p-8">
          <div className="max-w-lg rounded-lg bg-loom-err/10 border border-loom-err/40 p-6">
            <h2 className="text-loom-err font-semibold text-sm mb-2">渲染错误</h2>
            <pre className="text-xs text-loom-text font-mono whitespace-pre-wrap break-all">
              {this.state.error?.message ?? 'Unknown error'}
            </pre>
            <pre className="text-[10px] text-loom-muted font-mono whitespace-pre-wrap break-all mt-2">
              {this.state.error?.stack}
            </pre>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-3 px-3 py-1 text-xs rounded bg-loom-accent text-loom-bg font-semibold"
            >
              重试
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
