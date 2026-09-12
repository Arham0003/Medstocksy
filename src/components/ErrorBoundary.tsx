import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetBilling = () => {
    try {
      localStorage.removeItem('medstocksy.billSessions');
      // Remove any bill drafts
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('medstocksy.bill.')) {
          localStorage.removeItem(key);
        }
      });
    } catch {
      // ignore
    }
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="max-w-md w-full bg-white rounded-xl shadow-lg border border-gray-200 p-6 text-center space-y-4">
            <div className="h-12 w-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Something went wrong</h2>
            <p className="text-sm text-gray-600">
              {this.state.error?.message || 'An unexpected error occurred while rendering this page.'}
            </p>
            <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-center">
              <Button onClick={this.handleReload} variant="default" className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                <RefreshCw className="h-4 w-4" />
                Reload Page
              </Button>
              <Button onClick={this.handleResetBilling} variant="outline" className="gap-2 text-red-600 hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
                Reset Drafts
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
