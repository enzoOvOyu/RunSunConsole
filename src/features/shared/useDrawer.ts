import { useSearchParams } from "react-router-dom";
export function useDrawer() {
  const [params, setParams] = useSearchParams();
  const id = params.get("drawer") || "";
  const setId = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("drawer", id);
    else next.delete("drawer");
    setParams(next);
  };
  return { id, setId };
}
