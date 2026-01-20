import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import OAuthCallback from "./pages/OAuthCallback";
import NotFound from "./pages/NotFound";
// Lazy load heavy components
import { lazy, Suspense } from "react";

// Create a loading component for lazy loaded pages
const LoadingComponent = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
  </div>
);

// Lazy load pages that are not immediately needed
const Products = lazy(() => import("./pages/Products"));
const Sales = lazy(() => import("./pages/Sales"));
const SalesReturn = lazy(() => import("./pages/SalesReturn"));
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));
const Inventory = lazy(() => import("./pages/Inventory"));

const CustomerRelation = lazy(() => import("./pages/CustomerRelation"));
const PrintBill = lazy(() => import("./pages/PrintBill"));
const Pricing = lazy(() => import("./pages/Pricing"));
const AdminPanel = lazy(() => import("./pages/AdminPanel"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter basename="/">
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/auth/callback" element={<OAuthCallback />} />
            <Route path="/" element={<Layout />}>
              <Route index element={<Index />} />
              {/* Wrap lazy loaded components in Suspense */}
              <Route
                path="products"
                element={
                  <Suspense fallback={<LoadingComponent />}>
                    <Products />
                  </Suspense>
                }
              />
              <Route
                path="sales"
                element={
                  <Suspense fallback={<LoadingComponent />}>
                    <Sales />
                  </Suspense>
                }
              />
              <Route
                path="sales-return"
                element={
                  <Suspense fallback={<LoadingComponent />}>
                    <SalesReturn />
                  </Suspense>
                }
              />
              <Route
                path="customer-relation"
                element={
                  <Suspense fallback={<LoadingComponent />}>
                    <CustomerRelation />
                  </Suspense>
                }
              />
              <Route
                path="reports"
                element={
                  <Suspense fallback={<LoadingComponent />}>
                    <Reports />
                  </Suspense>
                }
              />
              <Route
                path="settings"
                element={
                  <Suspense fallback={<LoadingComponent />}>
                    <Settings />
                  </Suspense>
                }
              />
              <Route
                path="inventory"
                element={
                  <Suspense fallback={<LoadingComponent />}>
                    <Inventory />
                  </Suspense>
                }
              />
              <Route
                path="pricing"
                element={
                  <Suspense fallback={<LoadingComponent />}>
                    <Pricing />
                  </Suspense>
                }
              />
              <Route
                path="admin-control"
                element={
                  <Suspense fallback={<LoadingComponent />}>
                    <AdminPanel />
                  </Suspense>
                }
              />
            </Route>
            <Route
              path="/print-bill/:billId"
              element={
                <Suspense fallback={<LoadingComponent />}>
                  <PrintBill />
                </Suspense>
              }
            />
            {/* Fallback route for any unmatched paths */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;