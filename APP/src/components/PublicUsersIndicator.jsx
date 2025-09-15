import { useContext, useEffect, useState } from "react";
import { DBContext } from "@/context/DBContext";

export default function PublicUsersIndicator() {
  const { getPublicUsers } = useContext(DBContext);
  const [count, setCount] = useState(null);

  useEffect(() => {
    let canceled = false;
    const refresh = async () => {
      try {
        const users = await getPublicUsers();
        if (!canceled) setCount(Array.isArray(users) ? users.length : 0);
      } catch (_) {
        if (!canceled) setCount(0);
      }
    };
    refresh();
    const id = setInterval(refresh, 3000);
    return () => {
      canceled = true;
      clearInterval(id);
    };
  }, [getPublicUsers]);

  return (
    <div
      className="flex items-center gap-1 text-xs md:text-sm text-gray-600"
      title="Usuarios públicos en este dispositivo"
    >
      <span className="h-2 w-2 rounded-full bg-blue-500 inline-block"></span>
      <span>{count === null ? "…" : count}</span>
    </div>
  );
}
