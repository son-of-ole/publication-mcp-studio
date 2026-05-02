import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import HomePage from "@/pages/HomePage";
import PublicationsPage from "@/pages/PublicationsPage";
import ArticlePage from "@/pages/ArticlePage";
import AdminLoginPage from "@/pages/AdminLoginPage";
import AdminArticlesPage from "@/pages/AdminArticlesPage";
import AdminNewArticlePage from "@/pages/AdminNewArticlePage";
import AdminEditArticlePage from "@/pages/AdminEditArticlePage";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/publications" component={PublicationsPage} />
      <Route path="/publications/:slug" component={ArticlePage} />
      <Route path="/admin/login" component={AdminLoginPage} />
      <Route path="/admin/articles" component={AdminArticlesPage} />
      <Route path="/admin/articles/new" component={AdminNewArticlePage} />
      <Route path="/admin/articles/:id/edit" component={AdminEditArticlePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
