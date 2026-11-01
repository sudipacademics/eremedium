import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class PeoplePageBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('People HRMS page crashed', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="people-alert err" role="alert">
        <b>This page could not be displayed.</b> {this.state.error.message || 'Unexpected error.'}{' '}
        <button type="button" className="emp-btn" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
