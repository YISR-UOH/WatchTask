import { useState, useEffect } from "react";

export default function Footer() {
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
    <footer className="mt-auto bg-white border-t border-gray-200">
      <div className="max-w-5xl mx-auto px-4 py-3 text-xs text-gray-500 flex items-center justify-between">
        <span>© {new Date().getFullYear()} WatchTask v0.0.0.1</span>
      </div>
    </footer>
  );
}
