import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";
import type { FsEntry } from "@/lib/fs";

const BY_EXTENSION: [LucideIcon, string[]][] = [
  [FileImage, ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "ico", "tif", "tiff"]],
  [FileArchive, ["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz", "zst", "deb", "rpm", "jar"]],
  [FileVideo, ["mp4", "mkv", "avi", "mov", "webm", "wmv"]],
  [FileAudio, ["mp3", "wav", "flac", "ogg", "m4a"]],
  [FileSpreadsheet, ["csv", "tsv", "xls", "xlsx"]],
  [
    FileCode,
    [
      "js", "jsx", "ts", "tsx", "py", "rs", "go", "java", "c", "h", "cpp", "hpp", "cs", "rb", "php",
      "sh", "bash", "zsh", "ps1", "bat", "cmd", "sql", "html", "css", "scss", "json", "xml", "toml",
      "yaml", "yml", "vue", "kt", "swift", "lua", "pl",
    ],
  ],
  [FileText, ["txt", "md", "log", "ini", "conf", "cfg", "env", "rst", "pdf", "doc", "docx"]],
];

const ICONS = new Map(BY_EXTENSION.flatMap(([icon, exts]) => exts.map((ext) => [ext, icon] as const)));

export function fileIcon(entry: FsEntry, open: boolean): LucideIcon {
  if (entry.isDir) return open ? FolderOpen : Folder;
  const dot = entry.name.lastIndexOf(".");
  return (dot > 0 && ICONS.get(entry.name.slice(dot + 1).toLowerCase())) || File;
}
