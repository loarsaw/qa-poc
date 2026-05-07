import { Navigate, Route, Routes } from "react-router-dom";
import Sidebar from "@/components/layout/sidebar";
import ChatPage from "@/pages/chat_page";
import UploadPage from "@/pages/upload_page";
import LibraryPage from "@/pages/library_page";

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden bg-bg text-text">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:sessionId" element={<ChatPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </div>
    </div>
  );
}
