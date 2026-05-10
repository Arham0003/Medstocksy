import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

// Mock the lazy loaded components to avoid loading issues in tests
vi.mock('./pages/Products', () => ({
  default: () => <div>Products Page</div>
}));

vi.mock('./pages/Sales', () => ({
  default: () => <div>Sales Page</div>
}));

vi.mock('./pages/Reports', () => ({
  default: () => <div>Reports Page</div>
}));

vi.mock('./pages/Settings', () => ({
  default: () => <div>Settings Page</div>
}));

vi.mock('./pages/Inventory', () => ({
  default: () => <div>Inventory Page</div>
}));

describe('App', () => {
  it('renders without crashing', () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );
    expect(screen.getByText('Welcome to Local Stock')).toBeInTheDocument();
  });
});