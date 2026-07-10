import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/db conn/supabaseClient';
import SubscriptionGuard from './SubscriptionGuard';
import {
  Home,
  Package,
  ShoppingCart,
  BarChart3,
  Settings,
  LogOut,
  User,
  Users,
  RotateCcw,
  CreditCard,
  Truck,
  PackageX,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { memo, useEffect, useMemo, useState } from 'react';

const ownerNavItems = [
  { title: 'Overview', icon: Home, href: '/' },
  { title: 'Products', icon: Package, href: '/products' },
  { title: 'Suppliers', icon: Truck, href: '/suppliers' },
  { title: 'Purchase Return', icon: PackageX, href: '/purchase-return' },
  { title: 'Sales', icon: ShoppingCart, href: '/sales' },
  { title: 'Sales Return', icon: RotateCcw, href: '/sales-return' },
  { title: 'Customer Relation', icon: Users, href: '/customer-relation' },
  { title: 'Reports', icon: BarChart3, href: '/reports' },
  { title: 'Settings', icon: Settings, href: '/settings' },
  { title: 'Billing & Plans', icon: CreditCard, href: '/pricing' },
];

const extraRouteTitles: Record<string, string> = {
  '/record-sale': 'Record Sale',
  '/print-bill': 'Print Bill',
  '/admin': 'Admin Panel',
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AppSidebar = memo(({ accountName, userName }: { accountName: string; userName: string }) => {
  const { signOut } = useAuth();
  const location = useLocation();

  return (
    <Sidebar collapsible="icon" className="border-r bg-gradient-to-b from-sidebar to-sidebar-accent">
      <SidebarContent className="flex flex-col h-full">
        {/* Brand Header */}
        <div className="p-3 border-b border-sidebar-border">
          <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0">
            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg">
              <img src="/sidebar-logo.jpg" alt="Logo" className="h-full w-full object-cover" />
            </div>
            <div className="flex flex-col min-w-0 group-data-[collapsible=icon]:hidden">
              <div className="font-bold text-base text-sidebar-foreground truncate">{accountName}</div>
              <div className="text-[11px] text-muted-foreground truncate">Inventory Management</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <SidebarGroup className="flex-1 overflow-y-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              {ownerNavItems.map((item, index) => {
                const shortcutKey = index + 1 === 10 ? 0 : index + 1;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname === item.href}
                      tooltip={`${item.title} (${shortcutKey})`}
                      className="text-base py-3 rounded-lg hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                    >
                      <Link to={item.href} className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                          <item.icon className="h-5 w-5 shrink-0" />
                          <span className="group-data-[collapsible=icon]:hidden truncate">{item.title}</span>
                        </div>
                        <span className="text-xs text-muted-foreground group-data-[collapsible=icon]:hidden opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap ml-2">
                          {shortcutKey}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* User Profile Footer */}
        <SidebarFooter className="border-t border-sidebar-border p-3 mt-auto">
          <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0">
            <Avatar className="h-9 w-9 shrink-0 border border-sidebar-border">
              <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground text-xs font-semibold">
                {getInitials(userName)}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <div className="font-medium text-sidebar-foreground text-sm truncate">{userName}</div>
              <div className="text-[11px] text-muted-foreground">Manager</div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={signOut}
            className="w-full justify-start text-sm py-2 mt-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors group-data-[collapsible=icon]:hidden"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </SidebarFooter>
      </SidebarContent>
    </Sidebar>
  );
});

AppSidebar.displayName = 'AppSidebar';

function PageTitle() {
  const location = useLocation();
  const title = useMemo(() => {
    const exact = ownerNavItems.find((i) => i.href === location.pathname);
    if (exact) return exact.title;
    const extraKey = Object.keys(extraRouteTitles).find((k) => location.pathname.startsWith(k));
    if (extraKey) return extraRouteTitles[extraKey];
    return '';
  }, [location.pathname]);

  if (!title) return null;
  return <h1 className="text-base sm:text-lg font-semibold text-foreground truncate">{title}</h1>;
}

function UserMenu({ userName, accountName }: { userName: string; accountName: string }) {
  const { signOut } = useAuth();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 px-2 gap-2 hover:bg-accent">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
              {getInitials(userName)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden sm:inline text-sm font-medium truncate max-w-[120px]">{userName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="font-semibold truncate">{userName}</span>
            <span className="text-xs text-muted-foreground truncate">{accountName}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings" className="cursor-pointer">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/pricing" className="cursor-pointer">
            <CreditCard className="h-4 w-4 mr-2" />
            Billing & Plans
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={signOut}
          className="cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function Layout() {
  const { user, loading, profile } = useAuth();
  const [accountName, setAccountName] = useState('My Store');
  const [userName, setUserName] = useState('Manager');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ponytail: ignore navigation keys if typing in standard input or interacting with lists/popups/menus
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable ||
        target.closest('[role="listbox"]') ||
        target.closest('[role="dialog"]') ||
        target.closest('[role="menu"]')
      ) {
        return;
      }

      // Check numbers
      const key = parseInt(e.key);
      if (!isNaN(key)) {
        let item;
        if (key >= 1 && key <= 9) {
          item = ownerNavItems[key - 1];
        } else if (key === 0) {
          item = ownerNavItems[9];
        }
        
        if (item) {
          e.preventDefault();
          navigate(item.href);
        }
      }

      // Check up and down arrows
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const currentIndex = ownerNavItems.findIndex((item) => item.href === location.pathname);
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % ownerNavItems.length;
        const nextItem = ownerNavItems[nextIndex];
        if (nextItem) {
          navigate(nextItem.href);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const currentIndex = ownerNavItems.findIndex((item) => item.href === location.pathname);
        const prevIndex =
          currentIndex === -1
            ? ownerNavItems.length - 1
            : (currentIndex - 1 + ownerNavItems.length) % ownerNavItems.length;
        const prevItem = ownerNavItems[prevIndex];
        if (prevItem) {
          navigate(prevItem.href);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, location.pathname]);

  useEffect(() => {
    const fetchData = async () => {
      if (profile?.account_id) {
        const { data: accountData, error: accountError } = await supabase
          .from('accounts')
          .select('name, manager_name' as any)
          .eq('id', profile.account_id)
          .single();

        if (!accountError && accountData) {
          const data = accountData as any;
          setAccountName(data.name);
          if (data.manager_name) {
            setUserName(data.manager_name);
          } else if (profile?.email) {
            setUserName(profile.email.split('@')[0]);
          }
        } else if (profile?.email) {
          setUserName(profile.email.split('@')[0]);
        }
      }
    };

    fetchData();
  }, [profile?.account_id, profile?.email]);

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
        <AppSidebar accountName={accountName} userName={userName} />
        <main className="flex-1 flex flex-col min-w-0">
          <header className="border-b px-3 sm:px-4 py-2 bg-background sticky top-0 z-10 flex items-center gap-2 sm:gap-3">
            <SidebarTrigger className="h-9 w-9 shrink-0" />
            <div className="h-6 w-px bg-border shrink-0" />
            <div className="flex-1 min-w-0">
              <PageTitle />
            </div>
            <UserMenu userName={userName} accountName={accountName} />
          </header>
          <div className="flex-1 p-3 sm:p-6 overflow-y-auto min-w-0">
            <SubscriptionGuard>
              <Outlet />
            </SubscriptionGuard>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
