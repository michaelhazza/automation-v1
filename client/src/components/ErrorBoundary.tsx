import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-[400px] p-8">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 max-w-md text-center shadow-sm">
            <div className="text-slate-400 text-4xl mb-4">⚠</div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">
              Something went wrong
            </h2>
            <p className="text-sm text-slate-500 mb-6">
              An unexpected error occurred while rendering this page.
            </p>
            <button
              onClick={this.handleReload}
              className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
