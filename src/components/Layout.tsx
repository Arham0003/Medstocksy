import { Navigate, Outlet } from 'react-router-dom';
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { 
  Home, 
  Package, 
  ShoppingCart, 
  BarChart3, 
  Settings,
  LogOut,
  User,
  Store,
  Users,
  RotateCcw
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { memo, useEffect, useState } from 'react';

const ownerNavItems = [
  { title: 'Overview', icon: Home, href: '/' },
  { title: 'Products', icon: Package, href: '/products' },
  { title: 'Sales', icon: ShoppingCart, href: '/sales' },
  { title: 'Sales Return', icon: RotateCcw, href: '/sales-return' },
  { title: 'Customer Relation', icon: Users, href: '/customer-relation' },
  { title: 'Reports', icon: BarChart3, href: '/reports' },
  { title: 'Settings', icon: Settings, href: '/settings' },
];

// Memoized Sidebar component to prevent unnecessary re-renders
const AppSidebar = memo(() => {
  const { isOwner, signOut, profile } = useAuth();
  const location = useLocation();
  const [accountName, setAccountName] = useState('My Store');
  const [userName, setUserName] = useState('Store Owner');
  
  const navItems = ownerNavItems;

  // Fetch account name and user name
  useEffect(() => {
    const fetchData = async () => {
      if (profile?.account_id) {
        // Fetch account name
        const { data: accountData, error: accountError } = await supabase
          .from('accounts')
          .select('name')
          .eq('id', profile.account_id)
          .single();
        
        if (!accountError && accountData) {
          setAccountName(accountData.name);
        }
        
        // Fetch user name from profile
        if (profile?.email) {
          setUserName(profile.email.split('@')[0]);
        }
      }
    };
    
    fetchData();
  }, [profile?.account_id, profile?.email]);

  return (
    <Sidebar className="border-r bg-gradient-to-b from-sidebar to-sidebar-accent">
      <SidebarContent className="flex flex-col h-full">
        {/* Brand Header */}
        <div className="p-4 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="bg-primary p-2 rounded-lg">
              <Store className="h-6 w-6 text-primary-foreground" />
            </div>
            <div className="flex flex-col">
              <div className="font-bold text-lg text-sidebar-foreground">{accountName}</div>
              <div className="text-xs text-muted-foreground">Inventory Management</div>
            </div>
          </div>
        </div>
        
        {/* Navigation */}
        <SidebarGroup className="flex-1 overflow-y-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href} className="m-1">
                  <SidebarMenuButton 
                    asChild 
                    isActive={location.pathname === item.href}
                    className="text-base py-3 rounded-lg hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                  >
                    <Link to={item.href}>
                      <item.icon className="h-5 w-5" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        
        {/* User Profile Section */}
        <div className="p-4 border-t border-sidebar-border mt-auto">
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-sidebar-accent p-2 rounded-lg">
              <User className="h-5 w-5 text-sidebar-foreground" />
            </div>
            <div className="flex flex-col">
              <div className="font-medium text-sidebar-foreground">{userName}</div>
              <div className="text-xs text-muted-foreground">Store Owner</div>
            </div>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={signOut}
            className="w-full justify-start text-base py-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </SidebarContent>
    </Sidebar>
  );
});

AppSidebar.displayName = 'AppSidebar';

export default function Layout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <main className="flex-1 flex flex-col">
          <header className="border-b p-4 bg-background sticky top-0 z-10">
            <SidebarTrigger className="h-10 w-10" />
          </header>
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}