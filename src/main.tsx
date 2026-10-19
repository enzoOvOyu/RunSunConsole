import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { Providers, initialize } from "./app/providers";
import { router } from "./app/router";
import "./styles/theme.css";
import "./styles/global.css";
import { t } from "./i18n";
initialize()
  .then(() =>
    createRoot(document.getElementById("root")!).render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    ),
  )
  .catch(() => {
    document.getElementById("root")!.textContent = t("error.INTERNAL");
  });
