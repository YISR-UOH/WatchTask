import { useContext } from "react";
import { BrowserRouter, Routes, Route } from "react-router";
import { P2PContext } from "@/context/P2PContext";
import Header from "@/components/Header.jsx";
import Footer from "@/components/Footer.jsx";
import Login from "@/pages/Login.jsx";
export default function App() {
  const { online } = useContext(P2PContext);
  return (
    <BrowserRouter>
      <div className="min-h-dvh flex flex-col">
        <Header onLine={online} />
        <Routes>
          {/* Define your routes here if needed */}
          <Route path="/*" element={<Login />} />
        </Routes>

        <main className="flex-grow bg-gray-50"></main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}
