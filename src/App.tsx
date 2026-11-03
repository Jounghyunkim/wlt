import { useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { applyUiTheme } from "@/lib/themes";
import { useSettingsStore } from "@/store/settingsStore";

export default function App() {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => applyUiTheme(theme), [theme]);

  return <MainLayout />;
}
