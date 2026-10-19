import { withLocale } from "./withLocale";
import { useLocation } from "react-router-dom";
import { createBrowserRouter, Navigate } from "react-router-dom";
import ConsoleLayout from "./layouts/ConsoleLayout";
import { ErrorState } from "../components/ui";
import { ApiError } from "../lib/api-client";
export const router = createBrowserRouter([
  {
    path: "/",
    Component: ConsoleLayout,
    errorElement: <ErrorState error={new ApiError(500, "INTERNAL")} />,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      {
        path: "overview",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/overview/OverviewPage")).default,
          ),
        }),
      },
      {
        path: "resources/servers",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/resources/servers/ServersPage")).default,
          ),
        }),
      },
      {
        path: "resources/baremetal",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/resources/baremetal/BaremetalPage"))
              .default,
          ),
        }),
      },
      {
        path: "resources/vgpu",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/resources/vgpu/VgpuPage")).default,
          ),
        }),
      },
      {
        path: "resources/inference",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/resources/inference/InferencePage"))
              .default,
          ),
        }),
      },
      {
        path: "deployment/server",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/deployment/ServerWizard")).default,
          ),
        }),
      },
      {
        path: "deployment/baremetal",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/deployment/BaremetalWizard")).default,
          ),
        }),
      },
      {
        path: "deployment/vgpu",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/deployment/VgpuWizard")).default,
          ),
        }),
      },
      {
        path: "deployment/inference",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/deployment/InferenceWizard")).default,
          ),
        }),
      },
      {
        path: "ops/projects",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/ops/ProjectsPage")).default,
          ),
        }),
      },
      {
        path: "ops/quotas",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/ops/QuotasPage")).default,
          ),
        }),
      },
      {
        path: "ops/cost",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/ops/CostPage")).default,
          ),
        }),
      },
      {
        path: "ops/tickets",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/ops/TicketsPage")).default,
          ),
        }),
      },
      {
        path: "workbench/notebooks",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/workbench/NotebooksPage")).default,
          ),
        }),
      },
      {
        path: "workbench/images",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/workbench/ImagesPage")).default,
          ),
        }),
      },
      {
        path: "workbench/apps",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/workbench/AppsPage")).default,
          ),
        }),
      },
      {
        path: "workbench/scaling",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/workbench/ScalingPage")).default,
          ),
        }),
      },
      {
        path: "data/datasets",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/data/DatasetsPage")).default,
          ),
        }),
      },
      {
        path: "data/storage",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/data/StoragePage")).default,
          ),
        }),
      },
      {
        path: "data/pipelines",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/data/PipelinesPage")).default,
          ),
        }),
      },
      {
        path: "billing/bills",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/billing/BillsPage")).default,
          ),
        }),
      },
      {
        path: "billing/vouchers",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/billing/VouchersPage")).default,
          ),
        }),
      },
      {
        path: "ops/projects/:projectUuid",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/ops/ProjectsPage")).ProjectDetail,
          ),
        }),
      },
      {
        path: "ops/tickets/:id",
        lazy: async () => ({
          Component: withLocale(
            (await import("../features/ops/TicketsPage")).TicketDetail,
          ),
        }),
      },
      { path: "development/*", element: <LegacyWorkbench /> },
      {
        path: "*",
        element: <ErrorState error={new ApiError(404, "NOT_FOUND")} />,
      },
    ],
  },
]);

function LegacyWorkbench() {
  const location = useLocation();
  return (
    <Navigate
      replace
      to={
        location.pathname.replace("/development/", "/workbench/") +
        location.search
      }
    />
  );
}
