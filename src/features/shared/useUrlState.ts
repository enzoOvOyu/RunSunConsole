import { useSearchParams } from "react-router-dom";
export function useUrlState(name: string, initial = "") {
  const [params, setParams] = useSearchParams();
  const value = params.get(name) ?? initial;
  const setValue = (next: string) =>
    setParams(
      (current) => {
        const result = new URLSearchParams(current);
        if (next && next !== initial) result.set(name, next);
        else result.delete(name);
        return result;
      },
      { replace: true },
    );
  return [value, setValue] as const;
}
