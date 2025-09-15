import { useState, useEffect } from "react";
import PublicUsersIndicator from "@/components/PublicUsersIndicator";

export default function Header({ onLine }) {
  const [isScrolled, setIsScrolled] = useState(false);
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };

    window.addEventListener("scroll", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 w-full z-10 transition-all ${
        isScrolled ? "bg-white shadow-md" : "bg-transparent"
      }`}
    >
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">WatchTask</h1>
        <div className="flex items-center gap-3">
          <PublicUsersIndicator />
          <div
            className={`h-3 w-3 rounded-full ${
              onLine ? "bg-green-500" : "bg-red-500"
            }`}
            title={onLine ? "Online" : "Offline"}
          ></div>
        </div>
      </div>
    </header>
  );
}
